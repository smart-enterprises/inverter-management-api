import Employee from "../../models/employees.js";
import { NOTIFICATION_TARGET_ROLES } from "../../utils/notificationConstants.js";
import { deviceTokenService } from "./deviceTokenService.js";

const unique = (values = []) => [...new Set(values.filter(Boolean))];

export const notificationRecipientResolver = {
    resolve: async ({
        notificationType,
        targetRoles,
        targetEmployeeIds = [],
        excludeEmployeeIds = [],
    }) => {
        const roles = unique(targetRoles?.length ? targetRoles : NOTIFICATION_TARGET_ROLES[notificationType] || []);
        const runtimeEmployeeIds = unique(targetEmployeeIds);
        const excluded = new Set(excludeEmployeeIds.filter(Boolean));

        const roleEmployeeIds = roles.length
            ? await Employee.find({ role: { $in: roles }, status: "active" })
                .select("employee_id")
                .lean()
                .then((employees) => employees.map((employee) => employee.employee_id))
            : [];

        const employeeIds = unique([...roleEmployeeIds, ...runtimeEmployeeIds])
            .filter((employeeId) => !excluded.has(employeeId));

        if (!employeeIds.length) {
            return { roles, employeeIds: [], recipients: [], tokens: [] };
        }

        console.log("notificationType", notificationType, "employeeIds", employeeIds);

        const tokenRecords = await deviceTokenService.getActiveTokenRecordsByEmployeeIds(employeeIds);
        const dedupedByToken = new Map();

        for (const record of tokenRecords) {
            if (!record.token || excluded.has(record.employee_id)) continue;
            if (!dedupedByToken.has(record.token)) {
                dedupedByToken.set(record.token, {
                    employee_id: record.employee_id,
                    role: record.role,
                    token: record.token,
                    platform: record.platform,
                });
            }
        }

        const recipients = [...dedupedByToken.values()];

        return {
            roles,
            employeeIds,
            recipients,
            tokens: recipients.map((recipient) => recipient.token),
        };
    },
};

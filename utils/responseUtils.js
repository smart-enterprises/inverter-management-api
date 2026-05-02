export const buildResponse = ({
    res,
    status = 200,
    message,
    data,
    extra = {}
}) => {
    return res.status(status).json({
        success: true,
        status,
        message,
        data,
        ...extra,
        timestamp: new Date().toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata"
        })
    });
};

export const buildEmployeeListResponse = ({ data, page, limit, total }) => ({
    success: true,
    status: 200,
    message: "Employees retrieved successfully",
    data: {
        employees: data,
        pagination: page,
        limit,
        total,
        pages: Math.ceil(total / limit)
    },
    timestamp: new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata"
    })
});
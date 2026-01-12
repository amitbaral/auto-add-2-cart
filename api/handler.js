export default function handler(req, res) {
    // For now, return a simple response to test if the function works
    res.status(200).json({
        status: "ok",
        message: "Auto Add2Cart API is running",
        path: req.url
    });
}

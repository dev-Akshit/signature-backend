import { compareBcrypt } from "../libs/encryption.js";
import userModel from "../models/users.js";

export const loginUser = async (req, res) => {
    const { email, password } = req.body;
    const user = await userModel.findOne({ email });
    if (!user) {
        return res.status(400).json({
            error: 'Email is not valid',
        });
    }
    if (!await compareBcrypt(user.password, password)) {
        return res.status(400).json({
            error: 'Password is not valid',
        });
    }
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = user.role;
    req.session.name = user.name;
    req.session.courtId = user.courtId;
    req.session.phoneNumber = user.phoneNumber;
    req.session._internal = {};
    return res.json({ message: 'success' });
}
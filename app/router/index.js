import { Router } from "express";
import api from './api/index.js';
import { loginUser } from "../controller/userController.js";
import { checkLoginStatus } from "../middleware/checkAuth.js";

const router = Router();
router.use('/api', api);

router.post('/login', async (req, res, next) => {
    try {
        const isLoggedIn = checkLoginStatus(req, res);
        if (isLoggedIn) {
            return res.redirect('/');
        }
        await loginUser(req, res);
    } catch (error) {
        next(error);
    }
});

router.get('/session', checkLoginStatus, async (req, res, next) => {
    try {
        const sessionObj = {
            email: req.session.email,
            role: req.session.role,
            name: req.session.name,
            userId: req.session.userId,
            phoneNumber: req.session.phoneNumber,
        }
        return res.json(sessionObj);
    } catch (error) {
        next(error);
    }
});

router.get('/logout', async (req, res) => {
    const isLoggedIn = checkLoginStatus(req, res);
    if (!isLoggedIn) {
        return res.redirect('/login');
    }
    req.session.destroy();
    return res.json({ message: 'Success' });
});
export default router;
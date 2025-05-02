import {roles} from "../constants/index.js";

export const checkReader = (req, res, next) => {
    if(req.session?.role !== roles.reader) {
        return res.status(403).json({error: 'Not authorized'});
    }
    next();
}

export const checkOfficer = (req, res, next) => {
    if(req.session?.role !== roles.officer) {
        return res.status(403).json({error: 'Not authorized'});
    }
    next();
}

export const checkAccess = (req, res, next) => {
    if(![roles.reader, roles.officer].includes(req.session?.role)) {
        return res.status(403).json({error: 'Not authorized'});
    }
    next();
}
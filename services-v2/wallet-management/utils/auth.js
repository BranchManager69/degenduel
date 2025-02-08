import jwt from 'jsonwebtoken';
import { config } from '../../../config/config.js';
import prisma from '../../../config/prisma.js';

export async function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        
        if (!decoded.wallet_address) {
            throw new Error('Invalid token format');
        }

        const user = await prisma.users.findUnique({
            where: {
                wallet_address: decoded.wallet_address
            }
        });

        if (!user) {
            throw new Error('User not found');
        }

        return user;
    } catch (error) {
        throw new Error('Invalid token');
    }
} 
/**
 * Enum for user roles that matches the Prisma schema definition
 * @readonly
 * @enum {string}
 */
export const UserRole = {
  user: 'user',
  admin: 'admin',
  superadmin: 'superadmin'
};

Object.freeze(UserRole); 
/**
 * Validates a nickname according to the rules:
 * - Length between 4-15 characters
 * - Must start with a letter
 * - Only alphanumeric and underscore characters
 * - No consecutive underscores
 */
export function validateNickname(nickname) {
    if (!nickname || typeof nickname !== 'string') {
        return {
            isValid: false,
            error: 'Invalid nickname parameter'
        };
    }

    if (nickname.length < 4 || nickname.length > 15) {
        return {
            isValid: false,
            error: 'Nickname must be between 4 and 15 characters'
        };
    }

    if (!/^[a-zA-Z]/.test(nickname)) {
        return {
            isValid: false,
            error: 'Nickname must start with a letter'
        };
    }

    if (!/^[a-zA-Z0-9_]+$/.test(nickname)) {
        return {
            isValid: false,
            error: 'Nickname can only contain letters, numbers, and underscores'
        };
    }

    if (nickname.includes('__')) {
        return {
            isValid: false,
            error: 'Nickname cannot contain consecutive underscores'
        };
    }

    // Check for admin/mod impersonation
    const reservedPrefixes = ['admin_', 'mod_', 'moderator_', 'superadmin_'];
    if (reservedPrefixes.some(prefix => nickname.toLowerCase().startsWith(prefix))) {
        return {
            isValid: false,
            error: 'Nickname cannot impersonate staff members'
        };
    }

    return { isValid: true };
} 
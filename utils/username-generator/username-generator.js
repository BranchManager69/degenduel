import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { logApi } from '../logger-suite/logger.js';

// Get the directory name of the current module
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Read word lists from JSON file with error handling
let wordLists;
try {
  wordLists = JSON.parse(
    readFileSync(join(__dirname, './username-words.json'), 'utf8')
  );
} catch (error) {
  logApi.error('Failed to load username word lists:', error);
  // Provide fallback word lists in case file can't be read
  wordLists = {
    adjectives: ['COOL', 'MEGA', 'EPIC'],
    nouns: ['DEGEN', 'TRADER', 'CHAD']
  };
}

/**
 * Generates a fun default username for new users
 * Format: DEGEN_[ADJECTIVE/NOUN] (max 15 chars total including DEGEN_)
 * @returns {string} A unique default username
 */
export function generateDefaultUsername() {
  try {
    // Randomly choose between adjective or noun
    const wordList = Math.random() < 0.5 ? wordLists.adjectives : wordLists.nouns;
    
    // Ensure we have words to choose from
    if (!Array.isArray(wordList) || wordList.length === 0) {
      throw new Error('Word list is empty or invalid');
    }
    
    const word = wordList[Math.floor(Math.random() * wordList.length)];
    return `DEGEN_${word}`;
  } catch (error) {
    logApi.error('Error generating default username:', error);
    // Return a fallback username with timestamp to ensure uniqueness
    return `DEGEN_USER_${Date.now().toString(36).toUpperCase()}`;
  }
}

/**
 * Validates if a word should be blocked in usernames
 * @param {string} nickname - The nickname to check
 * @returns {boolean} True if the nickname contains blocked words
 */
export function containsBlockedWords(nickname) {
  const blockedWords = [
    'admin',
    'mod',
    'system',
    'support',
    'staff',
    'official',
    'degenduel',
    'degen_duel',
    'manager',
    'dev',
    'developer',
    'owner'
  ];

  const normalizedNick = nickname.toLowerCase();
  return blockedWords.some(word => normalizedNick.includes(word));
}

/**
 * Additional nickname validation rules
 * @param {string} nickname - The nickname to validate
 * @returns {{ isValid: boolean, error?: string }} Validation result and error message if invalid
 */
export function validateNicknameRules(nickname) {
  try {
    // Must start with a letter
    if (!/^[a-zA-Z]/.test(nickname)) {
      return { 
        isValid: false, 
        error: 'Nickname must start with a letter' 
      };
    }

    // Check for consecutive underscores
    if (nickname.includes('__')) {
      return { 
        isValid: false, 
        error: 'Nickname cannot contain consecutive underscores' 
      };
    }

    // Check for blocked words
    if (containsBlockedWords(nickname)) {
      return { 
        isValid: false, 
        error: 'Nickname contains restricted words' 
      };
    }

    return { isValid: true };
  } catch (error) {
    logApi.error('Error validating nickname rules:', error);
    return {
      isValid: false,
      error: 'Error validating nickname'
    };
  }
} 
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import { 
  createOrUpdateUser, 
  getUserProfile, 
  updateUserStats, 
  updateUserSettings 
} from '../src/utils/users.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

async function testUserFunctions() {
  try {
    console.log('\n1. Creating test user...');
    const user = await createOrUpdateUser('0xTestWallet123', 'TestUser');
    console.log('Created:', user);

    console.log('\n2. Getting user profile...');
    const profile = await getUserProfile('0xTestWallet123');
    console.log('Profile:', profile);

    console.log('\n3. Updating user stats...');
    const updatedStats = await updateUserStats('0xTestWallet123', {
      won: 100,
      contest_result: 'win'
    });
    console.log('Updated stats:', updatedStats);

    console.log('\n4. Updating user settings...');
    const updatedSettings = await updateUserSettings('0xTestWallet123', {
      theme: 'dark',
      notifications: true
    });
    console.log('Updated settings:', updatedSettings);

    return true;
  } catch (error) {
    console.error('Test failed:', error);
    return false;
  }
}

console.log('Starting comprehensive user tests...');
testUserFunctions();
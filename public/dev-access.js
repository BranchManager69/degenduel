/**
 * DegenDuel Dev Access Helper
 * 
 * This script helps you access the dev subdomain from any device.
 * It will prompt you for your dev access token and store it in localStorage.
 * Then it will add the token to all requests to the dev subdomain.
 * 
 * Usage:
 * 1. Save this file to your computer
 * 2. Open the dev subdomain in your browser
 * 3. Open the browser console (F12 or Ctrl+Shift+I)
 * 4. Copy and paste the contents of this file into the console
 * 5. Press Enter to run the script
 * 6. Enter your dev access token when prompted
 * 7. The page will reload and you should have access
 */

(function() {
  // Check if we're on the dev subdomain
  if (!window.location.hostname.includes('dev.degenduel.me')) {
    console.error('This script only works on the dev.degenduel.me subdomain.');
    return;
  }
  
  // Check if we already have a token
  const storedToken = localStorage.getItem('devAccessToken');
  
  if (storedToken) {
    console.log('Dev access token found in localStorage.');
    console.log('Using stored token for access...');
    
    // Add the token to the current page
    addTokenToPage(storedToken);
    return;
  }
  
  // Prompt for the token
  const token = prompt('Enter your dev access token:');
  
  if (!token) {
    console.error('No token provided. Access denied.');
    return;
  }
  
  // Store the token in localStorage
  localStorage.setItem('devAccessToken', token);
  console.log('Token stored in localStorage.');
  
  // Add the token to the current page
  addTokenToPage(token);
  
  // Function to add the token to the page
  function addTokenToPage(token) {
    // Create a meta tag with the token
    const meta = document.createElement('meta');
    meta.name = 'x-dev-access-token';
    meta.content = token;
    document.head.appendChild(meta);
    
    // Reload the page with the token in the header
    fetch(window.location.href, {
      headers: {
        'X-Dev-Access-Token': token
      }
    })
    .then(response => {
      if (response.ok) {
        console.log('Access granted! Reloading page...');
        window.location.reload();
      } else {
        console.error('Access denied. Invalid token.');
        localStorage.removeItem('devAccessToken');
      }
    })
    .catch(error => {
      console.error('Error accessing dev subdomain:', error);
    });
  }
})(); 
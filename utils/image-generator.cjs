/**
 * Universal Image Generator Utility
 * 
 * Features:
 * - Generate Mermaid diagrams
 * - Create user avatars with initials
 * - Generate charts and graphs
 * 
 * All images are stored in /public/generated-images/
 * and are accessible via /generated-images/{filename}
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// Constants
const PUBLIC_DIR = path.join(__dirname, '../public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'generated-images');
const TEMP_DIR = path.join(__dirname, '../temp');

// Ensure directories exist
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Generate a Mermaid diagram
 * @param {string} code - Mermaid diagram code
 * @param {string} filename - Output filename (without path)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Result with file paths and URLs
 */
async function generateMermaidDiagram(code, filename = null, options = {}) {
  // Generate filename if not provided
  if (!filename) {
    const hash = crypto.createHash('md5').update(code).digest('hex').substring(0, 8);
    filename = `mermaid-${hash}.png`;
  }
  
  // Ensure filename has extension
  if (!path.extname(filename)) {
    filename += '.png';
  }
  
  const outputPath = path.join(IMAGES_DIR, filename);
  const publicUrl = `/generated-images/${filename}`;
  
  // Create HTML with the Mermaid code
  const html = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: '${options.theme || 'default'}'
    });
  </script>
  <style>
    body {
      background: ${options.background || 'white'};
      margin: 0;
      padding: 20px;
      display: flex;
      justify-content: center;
    }
    .mermaid {
      font-family: 'Trebuchet MS', 'Lucida Sans Unicode', 'Lucida Grande', 'Lucida Sans', Arial, sans-serif;
    }
  </style>
</head>
<body>
  <div class="mermaid">
    ${code}
  </div>
</body>
</html>
  `;

  const tempId = crypto.randomBytes(8).toString('hex');
  const tempHtmlPath = path.join(TEMP_DIR, `temp-${tempId}.html`);
  
  // Write temporary HTML file
  fs.writeFileSync(tempHtmlPath, html);

  try {
    // Launch browser
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport size
    await page.setViewport({
      width: options.width || 800,
      height: options.height || 600,
      deviceScaleFactor: options.scale || 1
    });
    
    // Navigate to the HTML file
    await page.goto(`file://${tempHtmlPath}`);
    
    // Wait for the Mermaid diagram to render
    await page.waitForSelector('.mermaid svg');
    
    // Take screenshot of the diagram
    const element = await page.$('.mermaid');
    await element.screenshot({ path: outputPath });
    
    await browser.close();
    
    // Clean up
    fs.unlinkSync(tempHtmlPath);
    
    console.log(`Diagram rendered to ${outputPath}`);
    
    return {
      filename,
      filePath: outputPath,
      publicUrl
    };
  } catch (error) {
    console.error('Error rendering diagram:', error);
    throw error;
  }
}

/**
 * Generate a user avatar with initials
 * @param {string} name - User's name
 * @param {string} filename - Output filename (without path)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Result with file paths and URLs
 */
async function generateUserAvatar(name, filename = null, options = {}) {
  // Extract initials from name
  const initials = name
    .split(' ')
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase()
    .substring(0, 2);
  
  // Generate random color based on name if not provided
  let backgroundColor = options.backgroundColor;
  if (!backgroundColor) {
    const hash = crypto.createHash('md5').update(name).digest('hex');
    const hue = parseInt(hash.substring(0, 2), 16) % 360;
    backgroundColor = `hsl(${hue}, 65%, 55%)`;
  }
  
  // Generate filename if not provided
  if (!filename) {
    const hash = crypto.createHash('md5').update(name).digest('hex').substring(0, 8);
    filename = `avatar-${hash}.png`;
  }
  
  // Ensure filename has extension
  if (!path.extname(filename)) {
    filename += '.png';
  }
  
  const outputPath = path.join(IMAGES_DIR, filename);
  const publicUrl = `/generated-images/${filename}`;
  
  // Create HTML for the avatar
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      background: transparent;
    }
    .avatar {
      width: ${options.size || 200}px;
      height: ${options.size || 200}px;
      border-radius: ${options.rounded ? '50%' : '10%'};
      background-color: ${backgroundColor};
      color: white;
      display: flex;
      justify-content: center;
      align-items: center;
      font-family: 'Arial', sans-serif;
      font-size: ${(options.size || 200) / 2.5}px;
      font-weight: bold;
      text-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
  </style>
</head>
<body>
  <div class="avatar">${initials}</div>
</body>
</html>
  `;

  const tempId = crypto.randomBytes(8).toString('hex');
  const tempHtmlPath = path.join(TEMP_DIR, `temp-${tempId}.html`);
  
  // Write temporary HTML file
  fs.writeFileSync(tempHtmlPath, html);

  try {
    // Launch browser
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport size
    await page.setViewport({
      width: options.size || 200,
      height: options.size || 200
    });
    
    // Navigate to the HTML file
    await page.goto(`file://${tempHtmlPath}`);
    
    // Wait a bit for rendering (no need for specific selectors with avatars)
    await page.evaluate(() => new Promise(r => setTimeout(r, 100)));
    
    // Take screenshot
    const element = await page.$('.avatar');
    await element.screenshot({ 
      path: outputPath,
      omitBackground: true 
    });
    
    await browser.close();
    
    // Clean up
    fs.unlinkSync(tempHtmlPath);
    
    console.log(`Avatar rendered to ${outputPath}`);
    
    return {
      filename,
      filePath: outputPath,
      publicUrl
    };
  } catch (error) {
    console.error('Error rendering avatar:', error);
    throw error;
  }
}

/**
 * Generate a chart using Chart.js
 * @param {Object} chartConfig - Chart.js configuration
 * @param {string} filename - Output filename (without path)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Result with file paths and URLs
 */
async function generateChart(chartConfig, filename = null, options = {}) {
  // Generate filename if not provided
  if (!filename) {
    const hash = crypto.createHash('md5').update(JSON.stringify(chartConfig)).digest('hex').substring(0, 8);
    filename = `chart-${hash}.png`;
  }
  
  // Ensure filename has extension
  if (!path.extname(filename)) {
    filename += '.png';
  }
  
  const outputPath = path.join(IMAGES_DIR, filename);
  const publicUrl = `/generated-images/${filename}`;
  
  // Create HTML with Chart.js
  const html = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      background: ${options.background || 'white'};
    }
    #chart-container {
      width: ${options.width || 800}px;
      height: ${options.height || 400}px;
    }
  </style>
</head>
<body>
  <div id="chart-container">
    <canvas id="chart"></canvas>
  </div>
  <script>
    // Wait for page to load
    window.onload = () => {
      const ctx = document.getElementById('chart').getContext('2d');
      const chart = new Chart(ctx, ${JSON.stringify(chartConfig)});
      
      // Signal when chart is rendered
      document.body.classList.add('chart-rendered');
    };
  </script>
</body>
</html>
  `;

  const tempId = crypto.randomBytes(8).toString('hex');
  const tempHtmlPath = path.join(TEMP_DIR, `temp-${tempId}.html`);
  
  // Write temporary HTML file
  fs.writeFileSync(tempHtmlPath, html);

  try {
    // Launch browser
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport size
    await page.setViewport({
      width: options.width || 800,
      height: options.height || 400
    });
    
    // Navigate to the HTML file
    await page.goto(`file://${tempHtmlPath}`);
    
    // Wait for chart to render
    await page.waitForSelector('body.chart-rendered', { timeout: 2000 });
    
    // Take additional time for rendering
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
    
    // Take screenshot
    await page.screenshot({ path: outputPath });
    
    await browser.close();
    
    // Clean up
    fs.unlinkSync(tempHtmlPath);
    
    console.log(`Chart rendered to ${outputPath}`);
    
    return {
      filename,
      filePath: outputPath,
      publicUrl
    };
  } catch (error) {
    console.error('Error rendering chart:', error);
    throw error;
  }
}

// Command-line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  // Simple CLI
  if (command === 'mermaid') {
    const code = args[1] || `
graph TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Try again]
    C --> E[Continue]
    D --> B
    `;
    const filename = args[2] || null;
    
    generateMermaidDiagram(code, filename)
      .then(result => {
        console.log('Mermaid diagram generated:');
        console.log(`- File: ${result.filePath}`);
        console.log(`- URL: ${result.publicUrl}`);
      })
      .catch(err => console.error('Failed to generate diagram:', err));
  }
  else if (command === 'avatar') {
    const name = args[1] || 'John Doe';
    const filename = args[2] || null;
    const size = args[3] ? parseInt(args[3]) : 200;
    
    generateUserAvatar(name, filename, { size, rounded: true })
      .then(result => {
        console.log('Avatar generated:');
        console.log(`- File: ${result.filePath}`);
        console.log(`- URL: ${result.publicUrl}`);
      })
      .catch(err => console.error('Failed to generate avatar:', err));
  }
  else if (command === 'chart') {
    const type = args[1] || 'bar';
    const filename = args[2] || null;
    
    // Sample chart configuration
    const chartConfig = {
      type,
      data: {
        labels: ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'],
        datasets: [{
          label: 'Sample Data',
          data: [12, 19, 3, 5, 2, 3],
          backgroundColor: [
            'rgba(255, 99, 132, 0.2)',
            'rgba(54, 162, 235, 0.2)',
            'rgba(255, 206, 86, 0.2)',
            'rgba(75, 192, 192, 0.2)',
            'rgba(153, 102, 255, 0.2)',
            'rgba(255, 159, 64, 0.2)'
          ],
          borderColor: [
            'rgba(255, 99, 132, 1)',
            'rgba(54, 162, 235, 1)',
            'rgba(255, 206, 86, 1)',
            'rgba(75, 192, 192, 1)',
            'rgba(153, 102, 255, 1)',
            'rgba(255, 159, 64, 1)'
          ],
          borderWidth: 1
        }]
      },
      options: {
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    };
    
    generateChart(chartConfig, filename)
      .then(result => {
        console.log('Chart generated:');
        console.log(`- File: ${result.filePath}`);
        console.log(`- URL: ${result.publicUrl}`);
      })
      .catch(err => console.error('Failed to generate chart:', err));
  }
  else {
    console.log('Universal Image Generator');
    console.log('------------------------');
    console.log('Usage:');
    console.log('  node utils/image-generator.cjs mermaid [code] [filename]');
    console.log('  node utils/image-generator.cjs avatar [name] [filename] [size]');
    console.log('  node utils/image-generator.cjs chart [type] [filename]');
    console.log('\nAll generated images are accessible at:');
    console.log('  http://yourserver/generated-images/{filename}');
  }
}

// Export functions for programmatic use
module.exports = {
  generateMermaidDiagram,
  generateUserAvatar,
  generateChart
};
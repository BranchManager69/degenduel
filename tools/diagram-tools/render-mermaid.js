const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Simple script to render a Mermaid diagram
async function renderMermaid(code, outputPath) {
  // Create HTML with the Mermaid code
  const html = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default'
    });
  </script>
</head>
<body>
  <div class="mermaid">
    ${code}
  </div>
</body>
</html>
  `;

  // Write temporary HTML file
  const tempHtmlPath = path.join(__dirname, 'temp-mermaid.html');
  fs.writeFileSync(tempHtmlPath, html);

  try {
    // Launch browser
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.goto(`file://${tempHtmlPath}`);
    
    // Wait for the diagram to render
    await page.waitForSelector('.mermaid svg');
    
    // Get the SVG element
    const svgElement = await page.$('.mermaid svg');
    await svgElement.screenshot({ path: outputPath });
    
    console.log(`Diagram rendered to ${outputPath}`);
    
    await browser.close();
    
    // Clean up
    fs.unlinkSync(tempHtmlPath);
  } catch (error) {
    console.error('Error rendering diagram:', error);
  }
}

// Example Mermaid code
const mermaidCode = `
graph TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Try again]
    C --> E[Continue]
    D --> B
`;

// Ensure the output directory exists
const outputDir = path.join(__dirname, 'public/generated-images');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Render the diagram
renderMermaid(mermaidCode, path.join(outputDir, 'mermaid-output.png'));
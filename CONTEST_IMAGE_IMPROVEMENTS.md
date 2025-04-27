# Contest Image Generator Improvement Suggestions

## 1. Themed Image Generation Based on Token Types

Enhance the image generation by creating custom themes based on token categories or tags:

```javascript
// Add a theme detection function
function detectThemeFromTokens(tokens, contestName) {
  // Look for themes in token tags
  const allTags = tokens.flatMap(token => 
    token.tags && Array.isArray(token.tags) ? token.tags : []
  );
  
  // Count occurrences of different themes
  const themeCounts = {
    meme: allTags.filter(tag => ['meme', 'fun', 'doge', 'pepe'].includes(tag)).length,
    defi: allTags.filter(tag => ['defi', 'finance', 'yield', 'swap'].includes(tag)).length,
    gaming: allTags.filter(tag => ['game', 'gaming', 'metaverse', 'nft'].includes(tag)).length,
    ai: allTags.filter(tag => ['ai', 'artificial intelligence', 'ml', 'bot'].includes(tag)).length
  };
  
  // Check contest name for themes
  const contestLower = contestName.toLowerCase();
  if (/meme|doge|pepe|moon/.test(contestLower)) themeCounts.meme += 2;
  if (/defi|yield|finance|swap/.test(contestLower)) themeCounts.defi += 2;
  if (/game|gaming|play|nft/.test(contestLower)) themeCounts.gaming += 2;
  if (/ai|intelligence|bot|future/.test(contestLower)) themeCounts.ai += 2;
  
  // Find the dominant theme
  const dominant = Object.entries(themeCounts)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, count]) => count > 0)[0];
    
  return dominant ? dominant[0] : 'general';
}

// Add theme-specific style guidance to the prompt
function addThemeGuidance(prompt, theme) {
  switch(theme) {
    case 'meme':
      return prompt + " Create a vibrant, fun, meme-inspired image with bright colors, playful elements, and possibly subtle references to popular crypto memes. Use a whimsical and energetic style.";
    case 'defi':
      return prompt + " Create a sophisticated, sleek image with fintech elements, abstract representations of yield/liquidity, and a professional blue/green color palette. Use a modern, clean, and professional style.";
    case 'gaming':
      return prompt + " Create a dynamic, game-inspired image with interactive elements, futuristic interfaces, and vibrant neon accents. Use a style reminiscent of modern game UI with depth and dimension.";
    case 'ai':
      return prompt + " Create a futuristic, AI-themed image with neural network visualizations, abstracted data flows, and a high-tech aesthetic. Use a style that feels innovative and cutting-edge.";
    default:
      return prompt + " Create a balanced, modern crypto trading image that combines elements of technology, finance, and digital assets.";
  }
}
```

## 2. Token Logo Integration in Image Composition

Integrate actual token logos directly into the generated images for better brand recognition:

```javascript
// Add function to fetch token logos
async function getTokenLogos(tokens) {
  const logoPromises = tokens.map(async token => {
    // First check if we have a stored logo
    if (token.image_url) {
      return {
        symbol: token.symbol,
        logoUrl: token.image_url
      };
    }
    
    // Alternatively, try to fetch from an API or marketplace
    try {
      // Example: fetch from Jupiter or another API that has token logos
      const logoUrl = await fetchTokenLogoFromExternalSource(token.address);
      return {
        symbol: token.symbol,
        logoUrl
      };
    } catch (error) {
      console.log(`Failed to fetch logo for ${token.symbol}: ${error.message}`);
      return null;
    }
  });
  
  return (await Promise.all(logoPromises)).filter(Boolean);
}

// Modify the generateContestImage function to pass logo information
// Either by:
// 1. Adding logo information to the prompt (less effective)
// 2. Using the OpenAI API's image reference capability if available
// 3. Post-processing the generated image to overlay logos
```

## 3. Dynamic Image Style Based on Contest Performance

Create visually different images based on the contest's current performance or status:

```javascript
async function getContestMood(contestId) {
  // For new contests (no data yet)
  if (!contestId) return 'new';
  
  try {
    // Get contest participants count
    const participantCount = await prisma.contest_participants.count({
      where: { contest_id: contestId }
    });
    
    // Get contest target count
    const contest = await prisma.contests.findUnique({
      where: { id: contestId },
      select: { max_participants: true, min_participants: true }
    });
    
    if (!contest) return 'new';
    
    const targetCount = contest.max_participants || 50; // Default to 50 if not specified
    const minCount = contest.min_participants || 2;
    
    // Calculate fill percentage
    const fillPercentage = (participantCount / targetCount) * 100;
    
    // Determine mood based on participation
    if (fillPercentage >= 90) return 'hot'; // Almost full
    if (fillPercentage >= 50) return 'active'; // Half full
    if (participantCount < minCount) return 'needsmore'; // Not enough participants
    return 'normal'; // Default mood
  } catch (error) {
    console.error(`Error getting contest mood: ${error.message}`);
    return 'normal';
  }
}

// Add mood-specific styling to the prompt
function addMoodGuidance(prompt, mood) {
  switch(mood) {
    case 'hot':
      return prompt + " Create a high-energy image with vibrant warm colors (reds, oranges) that conveys excitement and high activity. Show visual elements that suggest popularity and competition.";
    case 'active':
      return prompt + " Create a balanced image with a mix of warm and cool colors showing steady activity. Include visual elements that suggest ongoing participation and engagement.";
    case 'needsmore':
      return prompt + " Create an inviting image with open composition and vibrant colors that suggests opportunity. Include visual elements that imply there's room for more participants.";
    case 'new':
      return prompt + " Create a fresh, exciting image that suggests the start of something new. Use bright, optimistic colors and visual elements that convey novelty and opportunity.";
    default:
      return prompt + " Create a balanced image with a professional crypto trading aesthetic.";
  }
}

// Modify generateContestImage to incorporate mood:
async function generateContestImage(contest, options = {}) {
  // Existing code...
  
  // Get contest mood if it's an existing contest
  const mood = contest.id ? await getContestMood(contest.id) : 'new';
  
  // Create base prompt
  let prompt = createImagePrompt(name, description, relatedTokens);
  
  // Enhance with theme if available
  const theme = detectThemeFromTokens(relatedTokens, name);
  prompt = addThemeGuidance(prompt, theme);
  
  // Enhance with mood
  prompt = addMoodGuidance(prompt, mood);
  
  // Rest of existing function...
}
```

These improvements would make your contest images more distinctive, relevant to the actual tokens being featured, and better aligned with the contest's current state without requiring any batch processing.
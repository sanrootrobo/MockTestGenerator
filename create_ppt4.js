import PptxGenJS from 'pptxgenjs';
import fs from 'fs';
import path from 'path';

// --- CLI AND HELPERS ---

/**
 * Displays a detailed help message for the CLI tool and exits.
 */
function showHelp() {
    console.log(`
  Generic PPTX Generator with Enhanced SVG Rendering
  --------------------------------------------------
  Creates a PowerPoint presentation from a generic JSON data file and a background image.

  Usage:
    node create-generic-ppt.js <json-file> <background-image>

  Arguments:
    <json-file>         Path to the input JSON file defining slides and their elements.
    <background-image>  Path to the image file to use as a slide background (e.g., .png, .jpg).

  Options:
    -h, --help          Display this help message.

  Example JSON Structure:
  {
    "slides": [
      {
        "elements": [
          {
            "type": "text",
            "content": "My Presentation Title",
            "options": { "x": 0.5, "y": 1.5, "w": "90%", "h": 1, "fontSize": 40, "bold": true, "align": "center" }
          },
          {
            "type": "text",
            "content": "A subtitle or description.",
            "options": { "x": 0.5, "y": 2.5, "w": "90%", "h": 0.5, "fontSize": 20, "align": "center" }
          }
        ]
      },
      {
        "elements": [
          {
            "type": "text",
            "content": "Slide with an SVG Image",
            "options": { "x": 0.5, "y": 0.5, "w": "90%", "fontSize": 32, "bold": true }
          },
          {
            "type": "svg",
            "content": "<svg>...</svg>",
            "options": { "x": 2.5, "y": 1.5, "maxWidth": 5, "maxHeight": 4, "centerAlign": true }
          }
        ]
      }
    ]
  }
  `);
}

/**
 * Adds a new slide with a background image.
 */
function addSlideWithBackground(pptx, imagePath) {
    const slide = pptx.addSlide();
    if (imagePath) {
        slide.background = { path: imagePath };
    }
    return slide;
}

// --- SVG PROCESSING FUNCTIONS (Unchanged) ---

/**
 * Enhanced SVG processing and rendering function
 */
function processSvg(svgContent) {
    if (!svgContent || !svgContent.includes('<svg')) return null;
    try {
        const svgMatch = svgContent.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
        if (!svgMatch) return null;
        let svgString = svgMatch[0];
        svgString = cleanSvgForPowerPoint(svgString);
        const base64Data = `data:image/svg+xml;base64,${Buffer.from(svgString).toString('base64')}`;
        const dimensions = extractSvgDimensions(svgString);
        return {
            data: base64Data,
            width: dimensions.width,
            height: dimensions.height,
            aspectRatio: dimensions.aspectRatio
        };
    } catch (error) {
        console.warn(`Warning: Failed to process SVG content: ${error.message}`);
        return null;
    }
}

/**
 * Clean and optimize SVG content for PowerPoint compatibility
 */
function cleanSvgForPowerPoint(svgString) {
    if (!svgString.includes('xmlns=')) {
        svgString = svgString.replace('<svg', '<svg xmlns="http://www.w.org/2000/svg"');
    }
    if (!svgString.includes('viewBox=')) {
        const widthMatch = svgString.match(/width=['"]([^'"]*)['"]/);
        const heightMatch = svgString.match(/height=['"]([^'"]*)['"]/);
        if (widthMatch && heightMatch) {
            const width = parseFloat(widthMatch[1]) || 400;
            const height = parseFloat(heightMatch[1]) || 300;
            svgString = svgString.replace('<svg', `<svg viewBox="0 0 ${width} ${height}"`);
        }
    }
    svgString = svgString.replace(/style\s*=\s*["'][^"']*["']/g, '');
    const styleTag = '<style>text{font-family:Arial,sans-serif;font-size:12px;}line,path,rect,circle{stroke-width:1;}</style>';
    svgString = svgString.replace('>', '>' + styleTag);
    return svgString;
}

/**
 * Extract dimensions from SVG for better positioning
 */
function extractSvgDimensions(svgString) {
    const widthMatch = svgString.match(/width=['"]([^'"]*)['"]/);
    const heightMatch = svgString.match(/height=['"]([^'"]*)['"]/);
    const viewBoxMatch = svgString.match(/viewBox=['"]([^'"]*)['"]/);
    let width = 400, height = 300;
    if (viewBoxMatch) {
        const viewBoxValues = viewBoxMatch[1].split(/\s+/);
        if (viewBoxValues.length >= 4) {
            width = parseFloat(viewBoxValues[2]) || 400;
            height = parseFloat(viewBoxValues[3]) || 300;
        }
    } else {
        if (widthMatch) width = parseFloat(widthMatch[1]) || 400;
        if (heightMatch) height = parseFloat(heightMatch[1]) || 300;
    }
    return { width, height, aspectRatio: width / height };
}

/**
 * Add SVG to slide with intelligent positioning and sizing
 */
function addSvgToSlide(slide, svgContent, options = {}) {
    const svgData = processSvg(svgContent);
    if (!svgData) return null;
    const { x = 0.5, y = 2, maxWidth = 4, maxHeight = 3, centerAlign = false } = options;
    let finalWidth = maxWidth;
    let finalHeight = maxHeight;
    if (svgData.aspectRatio > 1) {
        finalHeight = maxWidth / svgData.aspectRatio;
        if (finalHeight > maxHeight) {
            finalHeight = maxHeight;
            finalWidth = maxHeight * svgData.aspectRatio;
        }
    } else {
        finalWidth = maxHeight * svgData.aspectRatio;
        if (finalWidth > maxWidth) {
            finalWidth = maxWidth;
            finalHeight = maxWidth / svgData.aspectRatio;
        }
    }
    const finalX = centerAlign ? x - (finalWidth / 2) : x;
    const finalY = centerAlign ? y - (finalHeight / 2) : y;
    try {
        slide.addImage({ data: svgData.data, x: finalX, y: finalY, w: finalWidth, h: finalHeight });
        return { x: finalX, y: finalY, width: finalWidth, height: finalHeight };
    } catch (error) {
        console.warn(`Warning: Failed to add SVG to slide: ${error.message}`);
        return null;
    }
}

/**
 * Converts simple HTML (strong, br, p) to PptxGenJS rich text format.
 */
function convertHtmlToPptxRichText(html) {
    if (!html) return [{ text: '' }];
    const textWithNewlines = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?p>/gi, '');
    const parts = textWithNewlines.split(/(<\/?strong>)/g);
    const richText = [];
    let isBold = false;
    parts.forEach(part => {
        if (part === '<strong>') isBold = true;
        else if (part === '</strong>') isBold = false;
        else if (part) richText.push({ text: part, options: { bold: isBold } });
    });
    return richText.length > 0 ? richText : [{ text: textWithNewlines }];
}

// --- GENERIC SLIDE CREATION ---

/**
 * Creates a slide and populates it with elements defined in the slideData object.
 * @param {PptxGenJS} pptx - The PptxGenJS instance.
 * @param {object} slideData - An object from the JSON 'slides' array.
 * @param {string} bgImagePath - Path to the background image.
 */
function createGenericSlide(pptx, slideData, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    if (!slideData.elements || !Array.isArray(slideData.elements)) {
        console.warn('Warning: Slide object is missing a valid "elements" array. Skipping.');
        return;
    }

    slideData.elements.forEach((element, index) => {
        try {
            switch (element.type) {
                case 'text':
                    const textContent = typeof element.content === 'string' 
                        ? convertHtmlToPptxRichText(element.content) 
                        : element.content;
                    slide.addText(textContent, element.options || {});
                    break;

                case 'svg':
                    addSvgToSlide(slide, element.content, element.options || {});
                    break;
                
                case 'image': // Standard image support (e.g., PNG, JPG)
                    slide.addImage({ path: element.content, ...(element.options || {}) });
                    break;

                default:
                    console.warn(`Warning: Unknown element type "${element.type}" on slide. Skipping element ${index}.`);
            }
        } catch (error) {
            console.error(`Error processing element ${index} on a slide: ${error.message}`);
        }
    });
}

// --- MAIN SCRIPT EXECUTION ---
async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        showHelp();
        return;
    }
    if (args.length < 2) {
        console.error('Error: Missing required arguments.\n');
        showHelp();
        process.exit(1);
    }

    const [inputFilePath, backgroundImagePath] = args;
    const outputFileName = "Generated_Presentation.pptx";

    try {
        console.log("Validating inputs...");
        if (!fs.existsSync(inputFilePath)) {
            throw new Error(`Input JSON file not found at: ${inputFilePath}`);
        }
        if (!fs.existsSync(backgroundImagePath)) {
            throw new Error(`Background image not found at: ${backgroundImagePath}`);
        }
        console.log("Inputs validated.");

        console.log(`Reading data from ${inputFilePath}...`);
        let jsonData;
        try {
            jsonData = JSON.parse(fs.readFileSync(inputFilePath, 'utf-8'));
        } catch (parseError) {
            throw new Error(`Failed to parse JSON file. Check for syntax errors. Details: ${parseError.message}`);
        }

        if (!jsonData.slides || !Array.isArray(jsonData.slides)) {
            throw new Error('JSON file must contain a top-level "slides" array.');
        }

        console.log("Creating PowerPoint presentation with enhanced SVG rendering...");
        let pptx = new PptxGenJS();
        
        console.log(`Found ${jsonData.slides.length} slides to generate...`);
        jsonData.slides.forEach((slideData, index) => {
            console.log(`Processing slide ${index + 1}/${jsonData.slides.length}`);
            createGenericSlide(pptx, slideData, backgroundImagePath);
        });

        console.log(`Saving presentation to ${outputFileName}...`);
        await pptx.writeFile({ fileName: outputFileName });
        
        console.log(`\nSuccessfully created ${outputFileName}!`);
        console.log(`Total slides: ${jsonData.slides.length}`);

    } catch (error) {
        console.error(`\nAn error occurred during presentation generation:`);
        console.error(error.message);
        if (error.stack) {
            console.error('\nStack trace:');
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// Run the main function
main();

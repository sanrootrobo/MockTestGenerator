import PptxGenJS from 'pptxgenjs';
import fs from 'fs';
import path from 'path';

// --- CLI AND HELPERS ---

/**
 * Displays a detailed help message for the CLI tool and exits.
 */
function showHelp() {
    console.log(`
  Mock Exam PPTX Generator with Enhanced SVG Rendering
  --------------------------------------------------
  Creates a PowerPoint presentation from a JSON data file and a background image.

  Usage:
    node create-ppt.js <json-file> <background-image>

  Arguments:
    <json-file>         Path to the input JSON file containing the exam data.
    <background-image>  Path to the image file to use as a slide background (e.g., .png, .jpg).

  Options:
    -h, --help          Display this help message.
  `);
}

/**
 * Adds a new slide with a background image, ensuring it is fully visible.
 */
function addSlideWithBackground(pptx, imagePath) {
    const slide = pptx.addSlide();
    if (imagePath) {
        slide.background = { path: imagePath };
    }
    return slide;
}

/**
 * Enhanced SVG processing and rendering function
 */
function processSvg(svgContent) {
    if (!svgContent || !svgContent.includes('<svg')) return null;
    
    try {
        // Extract SVG content
        const svgMatch = svgContent.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
        if (!svgMatch) return null;
        
        let svgString = svgMatch[0];
        
        // Clean up and optimize SVG for PowerPoint
        svgString = cleanSvgForPowerPoint(svgString);
        
        // Convert to base64
        const base64Data = `data:image/svg+xml;base64,${Buffer.from(svgString).toString('base64')}`;
        
        // Extract dimensions for better positioning
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
    // Ensure SVG has proper namespace
    if (!svgString.includes('xmlns=')) {
        svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    
    // Set default viewBox if not present
    if (!svgString.includes('viewBox=')) {
        const widthMatch = svgString.match(/width=['"]([^'"]*)['"]/);
        const heightMatch = svgString.match(/height=['"]([^'"]*)['"]/);
        
        if (widthMatch && heightMatch) {
            const width = parseFloat(widthMatch[1]) || 400;
            const height = parseFloat(heightMatch[1]) || 300;
            svgString = svgString.replace('<svg', `<svg viewBox="0 0 ${width} ${height}"`);
        }
    }
    
    // Ensure proper styling for better PowerPoint rendering
    svgString = svgString.replace(/style\s*=\s*["'][^"']*["']/g, '');
    
    // Add default styling to ensure visibility
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
    
    let width = 400;
    let height = 300;
    
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
    
    return {
        width,
        height,
        aspectRatio: width / height
    };
}

/**
 * Add SVG to slide with intelligent positioning and sizing
 */
function addSvgToSlide(slide, svgContent, options = {}) {
    const svgData = processSvg(svgContent);
    if (!svgData) return null;
    
    const {
        x = 0.5,
        y = 2,
        maxWidth = 4,
        maxHeight = 3,
        centerAlign = false
    } = options;
    
    // Calculate optimal size while maintaining aspect ratio
    let finalWidth = maxWidth;
    let finalHeight = maxHeight;
    
    if (svgData.aspectRatio > 1) {
        // Wider than tall
        finalHeight = maxWidth / svgData.aspectRatio;
        if (finalHeight > maxHeight) {
            finalHeight = maxHeight;
            finalWidth = maxHeight * svgData.aspectRatio;
        }
    } else {
        // Taller than wide
        finalWidth = maxHeight * svgData.aspectRatio;
        if (finalWidth > maxWidth) {
            finalWidth = maxWidth;
            finalHeight = maxWidth / svgData.aspectRatio;
        }
    }
    
    // Adjust position for centering if requested
    const finalX = centerAlign ? x - (finalWidth / 2) : x;
    const finalY = centerAlign ? y - (finalHeight / 2) : y;
    
    try {
        slide.addImage({
            data: svgData.data,
            x: finalX,
            y: finalY,
            w: finalWidth,
            h: finalHeight
        });
        
        return {
            x: finalX,
            y: finalY,
            width: finalWidth,
            height: finalHeight
        };
    } catch (error) {
        console.warn(`Warning: Failed to add SVG to slide: ${error.message}`);
        return null;
    }
}

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

// --- SLIDE CREATION FUNCTIONS ---

function createTitleSlide(pptx, data, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(data.examTitle, {
        x: 0.5, y: 1.5, w: '90%', h: 1, fontSize: 40, bold: true, color: '003B75', align: 'center',
    });
    const details = data.examDetails;
    const detailsText = `Total Questions: ${details.totalQuestions}  |  Time Allotted: ${details.timeAllotted}  |  Max Marks: ${details.maxMarks}`;
    slide.addText(detailsText, {
        x: 0.5, y: 3.0, w: '90%', h: 0.5, fontSize: 20, color: '333333', align: 'center',
    });
}

function createInstructionsSlide(pptx, data, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(data.instructions.title, { 
        x: 0.5, y: 0.5, w: '90%', fontSize: 32, bold: true, color: '2B6CB0' 
    });
    const instructionPoints = data.instructions.points.map(point => ({ 
        text: point, 
        options: { fontSize: 18, bullet: true, paraSpcAfter: 10 } 
    }));
    slide.addText(instructionPoints, {
        x: 0.75, y: 1.5, w: '85%', h: 3.5,
    });
}

function createQuestionSlide(pptx, question, directions, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(`Question ${question.questionNumber}`, { 
        x: 0.5, y: 0.4, w: '90%', fontSize: 24, bold: true, color: '1A365D' 
    });

    let currentY = 1.0;
    
    // Add directions if present
    if (directions) {
        const cleanDirections = directions.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        slide.addText(`Directions: ${cleanDirections}`, {
            x: 0.5, y: currentY, w: '90%', h: 1.5,
            fontSize: 12, italic: true, color: '555555', fill: { color: 'E2E8F0' }, margin: 10
        });
        currentY += 1.7;
    }
    
    // Add question text
    const questionTextHeight = question.questionText.length > 200 ? 1.5 : 1;
    slide.addText(convertHtmlToPptxRichText(question.questionText), {
        x: 0.5, y: currentY, w: '90%', h: questionTextHeight, fontSize: 16
    });
    currentY += questionTextHeight + 0.2;

    // Add question SVG with enhanced rendering
    if (question.svg) {
        const svgPosition = addSvgToSlide(slide, question.svg, {
            x: 5,
            y: currentY,
            maxWidth: 4,
            maxHeight: 2.5,
            centerAlign: true
        });
        
        if (svgPosition) {
            currentY = Math.max(currentY + 2.7, svgPosition.y + svgPosition.height + 0.2);
        }
    }

    // Add options with enhanced SVG support
    const availableWidth = question.svg ? '60%' : '85%';
    question.options.forEach(opt => {
        const optionText = `${opt.label}) ${opt.text || ''}`;
        
        if (opt.svg) {
            // Option label
            slide.addText(`${opt.label})`, { 
                x: 0.75, y: currentY, w: 0.5, h: 0.5, fontSize: 14, bold: true 
            });
            
            // Option SVG
            const svgPosition = addSvgToSlide(slide, opt.svg, {
                x: 1.5,
                y: currentY,
                maxWidth: 2,
                maxHeight: 1,
                centerAlign: false
            });
            
            // Option text if present
            if (opt.text) {
                slide.addText(opt.text, { 
                    x: svgPosition ? 3.7 : 1.5, 
                    y: currentY, 
                    w: '40%', 
                    h: 0.5, 
                    fontSize: 14 
                });
            }
            
            currentY += 1.3;
        } else {
            // Text-only option
            slide.addText(optionText, { 
                x: 0.75, y: currentY, w: availableWidth, h: 0.3, fontSize: 14 
            });
            currentY += 0.4;
        }
    });
}

function createAnswerSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(`Answer & Solution: Q${question.questionNumber}`, { 
        x: 0.5, y: 0.4, w: '90%', fontSize: 24, bold: true, color: '1A365D' 
    });

    // Answer
    slide.addText(question.solution.answer, {
        x: 0.5, y: 1.0, w: '90%', h: 0.4,
        fontSize: 18, bold: true, color: '008000',
    });

    // Explanation text
    const explanationText = question.solution.explanation.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const hasSvg = question.solution.svg;
    
    slide.addText(explanationText, {
        x: 0.5, 
        y: 1.6, 
        w: hasSvg ? '50%' : '90%', 
        h: 3.8, 
        fontSize: 12,
        valign: 'top'
    });

    // Solution SVG with enhanced rendering
    if (hasSvg) {
        addSvgToSlide(slide, question.solution.svg, {
            x: 5.5,
            y: 1.8,
            maxWidth: 4,
            maxHeight: 3,
            centerAlign: false
        });
    }
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
    const outputFileName = "Mock_Exam_Presentation.pptx";

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
            throw new Error(`Failed to parse JSON file. Please check for syntax errors. Details: ${parseError.message}`);
        }

        console.log("Creating PowerPoint presentation with enhanced SVG rendering...");
        let pptx = new PptxGenJS();
        
        // Create slides
        createTitleSlide(pptx, jsonData, backgroundImagePath);
        createInstructionsSlide(pptx, jsonData, backgroundImagePath);

        // Collect all questions with their directions
        const allQuestions = [];
        jsonData.sections.forEach(section => {
            section.questionSets.forEach(qSet => {
                const directions = qSet.type === 'group' ? qSet.directions : null;
                qSet.questions.forEach(q => allQuestions.push({ ...q, directions }));
            });
        });

        console.log(`Creating ${allQuestions.length} question slides with SVG support...`);
        allQuestions.forEach((q, index) => {
            console.log(`Processing question ${index + 1}/${allQuestions.length}: Q${q.questionNumber}`);
            createQuestionSlide(pptx, q, q.directions, backgroundImagePath);
        });

        // Add answers section divider
        const answerTitleSlide = addSlideWithBackground(pptx, backgroundImagePath);
        answerTitleSlide.addText('Answers & Solutions', { 
            x: 0, y: '45%', w: '100%', align: 'center', 
            fontSize: 44, color: '003B75', bold: true 
        });

        console.log(`Creating ${allQuestions.length} answer slides with SVG support...`);
        allQuestions.forEach((q, index) => {
            console.log(`Processing answer ${index + 1}/${allQuestions.length}: Q${q.questionNumber}`);
            createAnswerSlide(pptx, q, backgroundImagePath);
        });

        console.log(`Saving presentation to ${outputFileName}...`);
        await pptx.writeFile({ fileName: outputFileName });
        console.log(`\nSuccessfully created ${outputFileName} with enhanced SVG rendering!`);
        console.log(`Total slides: ${2 + allQuestions.length * 2 + 1}`); // Title + Instructions + Questions + Answer divider + Answers

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

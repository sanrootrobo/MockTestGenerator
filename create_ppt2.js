import PptxGenJS from 'pptxgenjs';
import fs from 'fs';
import path from 'path';

// --- CLI AND HELPERS ---

/**
 * Displays a detailed help message for the CLI tool and exits.
 */
function showHelp() {
    console.log(`
  Mock Exam PPTX Generator
  ------------------------
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
 * THIS IS THE CORRECTED FUNCTION.
 */
function addSlideWithBackground(pptx, imagePath) {
    const slide = pptx.addSlide();
    if (imagePath) {
        // Set the background image. The overlay box is not added here.
        slide.background = { path: imagePath };
    }
    return slide;
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

function svgToBase64(svgContent) {
    if (!svgContent || !svgContent.includes('<svg')) return null;
    const svgMatch = svgContent.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
    if (!svgMatch) return null;
    return `data:image/svg+xml;base64,${Buffer.from(svgMatch[0]).toString('base64')}`;
}

// --- SLIDE CREATION FUNCTIONS ---

function createTitleSlide(pptx, data, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    // Note: If your background is dark, you may need to change text colors here.
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
    slide.addText(data.instructions.title, { x: 0.5, y: 0.5, w: '90%', fontSize: 32, bold: true, color: '2B6CB0' });
    const instructionPoints = data.instructions.points.map(point => ({ text: point, options: { fontSize: 18, bullet: true, paraSpcAfter: 10 } }));
    slide.addText(instructionPoints, {
        x: 0.75, y: 1.5, w: '85%', h: 3.5,
    });
}

function createQuestionSlide(pptx, question, directions, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(`Question ${question.questionNumber}`, { x: 0.5, y: 0.4, w: '90%', fontSize: 24, bold: true, color: '1A365D' });

    let currentY = 1.0;
    if (directions) {
        const cleanDirections = directions.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        slide.addText(`Directions: ${cleanDirections}`, {
            x: 0.5, y: currentY, w: '90%', h: 1.5,
            fontSize: 12, italic: true, color: '555555', fill: { color: 'E2E8F0' }, margin: 10
        });
        currentY += 1.7;
    }
    const questionTextHeight = question.questionText.length > 200 ? 1.5 : 1;
    slide.addText(convertHtmlToPptxRichText(question.questionText), {
        x: 0.5, y: currentY, w: '90%', h: questionTextHeight, fontSize: 16
    });
    currentY += questionTextHeight + 0.2;

    if (question.svg) {
        const base64Svg = svgToBase64(question.svg);
        if (base64Svg) {
            slide.addImage({ data: base64Svg, x: 3, y: currentY, w: 4, h: 2 });
            currentY += 2.2;
        }
    }
    question.options.forEach(opt => {
        const optionText = `${opt.label}) ${opt.text || ''}`;
        if (opt.svg) {
             slide.addText(`${opt.label})`, { x: 0.75, y: currentY, w: 0.5, h: 0.5, fontSize: 14 });
            const base64Svg = svgToBase64(opt.svg);
            if (base64Svg) slide.addImage({ data: base64Svg, x: 1.25, y: currentY - 0.25, w: 1, h: 1 });
            currentY += 1.2;
        } else {
            slide.addText(optionText, { x: 0.75, y: currentY, w: '85%', h: 0.3, fontSize: 14 });
            currentY += 0.4;
        }
    });
}

function createAnswerSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(`Answer & Solution: Q${question.questionNumber}`, { x: 0.5, y: 0.4, w: '90%', fontSize: 24, bold: true, color: '1A365D' });

    slide.addText(question.solution.answer, {
        x: 0.5, y: 1.0, w: '90%', h: 0.4,
        fontSize: 18, bold: true, color: '008000',
    });
    const explanationText = question.solution.explanation.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const hasSvg = question.solution.svg && svgToBase64(question.solution.svg);
    slide.addText(explanationText, {
        x: 0.5, y: 1.6, w: hasSvg ? '50%' : '90%', h: 3.8, fontSize: 12,
    });
    if (hasSvg) {
        slide.addImage({ data: svgToBase64(question.solution.svg), x: 5.5, y: 1.8, w: 4, h: 3, });
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
        console.error('❌ Error: Missing required arguments.\n');
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
        console.log("✅ Inputs validated.");

        console.log(`Reading data from ${inputFilePath}...`);
        let jsonData;
        try {
            jsonData = JSON.parse(fs.readFileSync(inputFilePath, 'utf-8'));
        } catch (parseError) {
            throw new Error(`Failed to parse JSON file. Please check for syntax errors. Details: ${parseError.message}`);
        }

        let pptx = new PptxGenJS();
        createTitleSlide(pptx, jsonData, backgroundImagePath);
        createInstructionsSlide(pptx, jsonData, backgroundImagePath);

        const allQuestions = [];
        jsonData.sections.forEach(section => {
            section.questionSets.forEach(qSet => {
                const directions = qSet.type === 'group' ? qSet.directions : null;
                qSet.questions.forEach(q => allQuestions.push({ ...q, directions }));
            });
        });

        console.log('Creating question slides...');
        allQuestions.forEach(q => createQuestionSlide(pptx, q, q.directions, backgroundImagePath));

        const answerTitleSlide = addSlideWithBackground(pptx, backgroundImagePath);
        answerTitleSlide.addText('Answers & Solutions', { x: 0, y: '45%', w: '100%', align: 'center', fontSize: 44, color: '003B75', bold: true });

        console.log('Creating answer slides...');
        allQuestions.forEach(q => createAnswerSlide(pptx, q, backgroundImagePath));

        console.log(`Saving presentation to ${outputFileName}...`);
        await pptx.writeFile({ fileName: outputFileName });
        console.log(`\n✅ Successfully created ${outputFileName}!`);

    } catch (error) {
        console.error(`\n❌ An error occurred during presentation generation:`);
        console.error(error.message);
        process.exit(1);
    }
}

// Run the main function
main();

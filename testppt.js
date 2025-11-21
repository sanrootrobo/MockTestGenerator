import path from 'path';
import * as PptxAutomizerModule from 'pptx-automizer';

// This robustly finds the constructor, handling module format differences.
const Automizer = PptxAutomizerModule.default || PptxAutomizerModule.Automizer;
const modify = PptxAutomizerModule.modify;

async function createPresentation() {
  // Add a check to give a clearer error if the constructor isn't found
  if (typeof Automizer !== 'function') {
    throw new Error('Could not find the Automizer constructor. Please check your pptx-automizer import and version.');
  }

  const automizer = new Automizer({
    templateDir: process.cwd(),
    outputDir: process.cwd(),
  });

  const pres = automizer
    .loadRoot('template.pptx')
    .load('template.pptx', 'template'); // You still need to load the template by name

  pres.addSlide('template', 1, (slide) => {
    // The second argument for modifyElement needs to be an array
    slide.modifyElement('question_text', [
      modify.replaceText('Hello pptx-automizer!'),
    ]);
  });

  const outputPath = path.join(process.cwd(), 'output.pptx');
  await pres.write(outputPath);
  console.log(`Presentation saved to ${outputPath}`);
}

createPresentation().catch(console.error);

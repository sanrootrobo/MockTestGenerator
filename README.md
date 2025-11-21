

````markdown
# 🚀 Gemini AI Mock Test Generator
**The Ultimate Automated Exam Creation Tool**

---

## 📖 Overview

The **Gemini AI Mock Test Generator** is a powerful automation tool designed for EdTech platforms, educators, and developers.  
It utilizes advanced LLMs to analyze your existing **Previous Year Questions (PYQs)** and **Reference Mocks**.

By understanding the pattern, difficulty, and style of your input files, it generates brand-new, plagiarism-free questions with **detailed solutions** and **SVG diagrams**.  
The output is instantly formatted into **PDF**, **PowerPoint (PPTX)**, and **JSON** for seamless integration.

---

## ✨ Key Features

### 🧠 Context-Aware AI Generation

- **Style Mimicry:** Analyzes input PDFs to replicate the tone and difficulty of the target exam.  
- **Multi-Modal Thinking:** Generates text + SVG diagrams for geometry, DI, and logical reasoning.  
- **Reasoning Models:** Full support for Gemini Thinking Models with configurable token budgets.

---

### 📦 Professional Output Formats

- **Print-Ready PDFs:** Rendered with Puppeteer for academy-grade layouts.  
- **PPTX Slides:** Auto-generated professional presentations.  
- **JSON Data:** Clean schema for LMS/Apps.

---

### ⚙️ Enterprise-Grade Architecture

- **Smart Rate Limiting**  
- **API Key Rotation**  
- **High Concurrency (10–100 mocks in parallel)**  

---

## 🛠️ Installation

Ensure you have **Node.js v18+** installed.

Clone the repository:

```bash
git clone https://github.com/yourusername/ai-mock-test-generator.git
cd ai-mock-test-generator
````

Install dependencies:

```bash
npm install @google/genai commander puppeteer pptxgenjs
```

Configure API keys:

Create a file named `api_key.txt` in the root directory and paste your Google GenAI keys (one per line).

---

## 🚀 Quick Start

Organize your data:

```
/pyqs            → Folder with past exam PDFs
/refs            → Folder with reference mock PDFs
prompt.txt       → Custom instructions for the mock test
```

Run the generator:

```bash
node script.js --pyq ./pyqs --reference-mock ./refs --prompt prompt.txt --output ./results/mock_test
```

---

## 🎛️ Advanced Usage & CLI Options

| Option               | Description                                    | Default          |
| -------------------- | ---------------------------------------------- | ---------------- |
| `--output, -o`       | Base output filename                           | Required         |
| `--number-of-mocks`  | Number of unique tests to generate             | 1                |
| `--ppt`              | Enable PowerPoint output                       | Disabled         |
| `--ppt-background`   | Background image path for PPT slides           | null             |
| `--model`            | Gemini model (e.g., gemini-2.0-flash-thinking) | gemini-2.5-flash |
| `--thinking-budget`  | Token budget for reasoning                     | null             |
| `--concurrent-limit` | Max parallel generations                       | 3                |
| `--save-json`        | Save raw JSON                                  | Disabled         |

---

### Example: High-Volume Production Run

Generate **10 unique Logical Reasoning tests** with PPT slides using a Thinking model:

```bash
node script.js \
  --pyq ./data/cat_exam_pyq \
  --reference-mock ./data/coaching_mocks \
  --prompt ./instructions/lr_hard.txt \
  --output ./production/batch_01/test \
  --number-of-mocks 10 \
  --concurrent-limit 5 \
  --ppt \
  --ppt-background ./assets/brand_bg.jpg \
  --model gemini-2.0-flash-thinking-exp \
  --thinking-budget 4096
```

---

## 🎯 Use Cases

* **EdTech Startups:** Scale from 10 to 1000 tests automatically.
* **Coaching Institutes:** Personalized homework sheets from PYQs.
* **YouTube Creators:** Generate ready-made PPTs for video explanations.
* **Developers:** Use JSON for quiz apps or LMS content.

---

## 📄 License

This project is licensed under the **GPL-3.0 License** — see the `LICENSE` file for full details.

```

---

If you want, I can also generate:

✅ README badges  
✅ A polished repository description  
✅ Folder structure diagrams  
✅ A clean JSON schema for the exported test data  

Just tell me **"improve further"** or **"add badges"**.
```

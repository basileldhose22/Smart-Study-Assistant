# Smart Study Assistant

> Upload a PDF. Get a full study dashboard — summary, notes, study plan, quiz and recommendations — powered by AI.

A browser-based study tool built with plain HTML and JavaScript. No backend, no server, no framework. Just two files that run entirely in your browser.

---

## Features

| Feature | Description |
|---|---|
| Document Viewer | View your uploaded PDF inside the app without switching tabs |
| AI Summary | Get key concepts, estimated read time, and difficulty level instantly |
| Study Plan | A day-by-day schedule created from your document |
| Smart Notes | Personalised notes based on your age and preferred style |
| Quiz | 10 multiple-choice questions generated from your PDF with colour-coded scoring |
| Video Recommendations | YouTube search links for further study on your topic |
| AI Chat | Ask questions about your document and get answers using it as context |
| Voice Input | Speak your question instead of typing using the browser microphone |
| Text-to-Speech | AI replies are read aloud — toggle it on or off anytime |
| Dark Mode | Auto-detects your system theme with a manual toggle button |

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/your-username/smart-study-assistant.git
cd smart-study-assistant
```

### 2. Get a free Gemini API key

Go to [aistudio.google.com](https://aistudio.google.com), click **Get API Key**, and copy it.
The free tier is sufficient to run this project.

### 3. Run a local server

The microphone feature requires a secure context, so the HTML file cannot be opened directly from the file system. Run a simple local server instead.

Using Python:
```bash
python -m http.server 5500
```

Using Node.js:
```bash
npx serve .
```

Then open `http://localhost:5500` in your browser.

### 4. Use the app

- Paste your Gemini API key into the input field in the top-right corner
- Type your age and note preference in the chat, for example: *I am 18 and I want simple bullet point notes*
- Upload a PDF and wait around 15 to 20 seconds for the AI to analyse it
- Explore the tabs in the dashboard — Summary, Study Plan, Notes, Quiz, Recommendations

---

## Project Structure

```
smart-study-assistant/
│
├── index.html       -- All UI elements: layout, panels, tabs, upload zone
└── app.js           -- All logic: PDF extraction, API calls, quiz, chat, voice
```

No node_modules, no build step, no configuration files.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| HTML5 | Page structure and layout |
| CSS / Tailwind CSS | Styling, dark mode, and responsive design |
| JavaScript (ES6+) | All application logic |
| PDF.js | Client-side PDF text extraction |
| Gemini 2.5 Flash API | AI analysis and content generation |
| Marked.js | Renders AI Markdown output as formatted HTML |
| Web Speech API | Voice input and text-to-speech, built into the browser |
| Font Awesome | Icons used throughout the interface |

---

## How It Works

```
User enters preferences (age and note style)
        |
User uploads a PDF
        |
PDF.js extracts text from each page
        |
Text is sent to the Gemini API with a structured prompt
        |
Gemini returns JSON with summary, notes, plan, quiz, and recommendations
        |
Dashboard tabs are filled with the generated content
        |
User can chat, take the quiz, or ask questions by voice
```

---

## Known Limitations

- The API key is entered on the client side and can be seen in browser DevTools. A backend proxy would be needed for production use.
- PDF text is capped at 40,000 characters, so very long documents are only partially analysed.
- Only PDF files are supported. Word documents and images are not.
- There is no session saving. Refreshing the page resets everything.
- Voice input only works on localhost or HTTPS. Opening the HTML file directly will block microphone access.

---

## Possible Improvements

- Add a backend proxy to keep the API key hidden
- Allow exporting notes and the study plan as a PDF or Word file
- Add support for Word documents and plain text files
- Save sessions to localStorage so progress is not lost on refresh
- Add multi-language support for notes and voice input

---
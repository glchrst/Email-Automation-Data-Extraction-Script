# Invoice & Overbilling Automation Script 🚀

A lightweight productivity tool designed to streamline the administrative workflow. This script adds a functional button to the webpage that instantly extracts data and generates a pre-formatted email for invoicing and overbilling inquiries.

---

## 📖 Background
I created this project to eliminate the repetitive "copy-paste" cycle associated with manual data entry. By automating the data collection and email drafting process, this script reduces human error and saves significant time during daily billing tasks.

## ✨ Key Features
* **One-Click Extraction:** Automatically gathers relevant metadata (Order IDs, User Info, Totals) from the active webpage.
* **Smart Mail Integration:** Launches your default email client with a pre-filled subject line and body text.
* **Custom UI:** Injects an unobtrusive button directly into the target site for immediate access.
* **Workflow Optimization:** Turns a multi-step manual process into a single-click action.

## 🛠️ Tech Stack
* **Language:** JavaScript
* **Environment:** [e.g., Tampermonkey / Greasemonkey / Chrome Extension]
* **Protocol:** Utilizes `mailto:` parameters for client-side email generation.

## 🚀 Installation
1.  Install a UserScript manager like **[Tampermonkey](https://www.tampermonkey.net/)**.
2.  Create a **New Script** in the dashboard.
3.  Copy and paste the code from `script.js` into the editor.
4.  Ensure the `@match` header in the script points to your target website URL.
5.  Save and refresh your webpage.

## 🖥️ Usage
1.  Navigate to your target billing or invoice page.
2.  Locate the **[Button Name]** (usually added to the [top/bottom] of the page).
3.  Click the button to automatically open a drafted email with all gathered data already filled in.

---

## 📝 License
This project is open-source and available under the [MIT License](LICENSE).

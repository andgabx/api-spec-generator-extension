# SpecCatcher

> A Chrome DevTools extension built for studying, understanding how the web works, and analyzing APIs to test and build integrations across various applications.

SpecCatcher hooks into your browser's network traffic in real-time, analyzing the requests and responses made by the page. By inferring data structures on the fly, it builds detailed JSON schemas, decodes tokens, and allows you to easily export the documented endpoints into standard formats like **OpenAPI 3.1** and **Postman Collection v2.1**.

![Panel screenshot](screenshot.png)

---

## 🚀 Key Features

- **Real-Time Capture**: Seamlessly intercepts network requests as they happen, documenting the API surface simply by browsing the application.
- **Smart Schema Inference**: Automatically analyzes JSON bodies to determine data types, formats (like `uuid`, `date-time`, or `uri`), and nested structures.
- **Privacy First (Data Redaction)**: Automatically redacts sensitive information such as `Authorization` headers, `Cookie`s, and `X-API-Key`s before rendering them, ensuring safe screen sharing and exporting.
- **Versatile Exporting**: Select specific endpoints and export them as an **OpenAPI 3.1** specification or a ready-to-use **Postman Collection v2.1**.
- **Universal JWT Scanner**: A strict, zero-false-positive engine that scans every layer of an HTTP request for JSON Web Tokens.

---

## 📖 Understanding the Icons (Legend)

The left sidebar uses visual indicators so you can understand an endpoint at a glance:

- 🔒 **Authenticated:** The request includes authentication headers or cookies.
- 🌐 **Public:** The request does not contain any authentication information.
- 🔑 **JWT Detected:** A JSON Web Token was found transmitting through this endpoint. Click it to see the decoded token payload!
- 🟣 **Purple Dot:** Indicates the request contains a Body Payload (e.g., POST/PUT data).
- 🗑️ **Clear Button:** Use this button at the top to completely wipe the visual list and the background memory, giving you a clean slate for testing.

**Status Colors:**
- **Green (2xx):** Success.
- **Yellow (3xx):** Redirect.
- **Red (4xx/5xx):** Client or Server Error.

---

## 🕵️‍♂️ JWT Scanner & Limitations

SpecCatcher features a powerful **Universal JWT Scanner** that looks for JSON Web Tokens in:
- Request and Response Headers (e.g., `Authorization`, `x-access-token`)
- Cookies (both incoming and outgoing)
- URL Query Parameters
- Request and Response JSON Bodies

When a token is found, a 🔑 icon appears, and a dedicated JWT Decoder section is rendered in the details panel showing the exact source of the token and its decoded payload.

**⚠️ Important Limitations & Architectural Behaviors:**
Not all APIs use JWTs. Many systems (especially academic or legacy enterprise platforms) use alternative approaches:
- **Opaque Session IDs (e.g., JSESSIONID):** These are random strings that hold no decodable data. SpecCatcher will mark the endpoint as Authenticated (🔒) but will **not** show the JWT icon since there is nothing to decode.
- **Simple Base64 Strings:** Some applications store user data in cookies using plain Base64 encoded JSON (without the 3-part signature structure of a true JWT). To avoid false positives, our scanner strictly checks for the cryptographic signature structure. If it's just plain Base64, the scanner intentionally ignores it.

---

## 🛠 Installation

This extension is currently intended for manual installation via Developer Mode:

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the repository folder.
5. Open any web page, press **F12** to open DevTools, and navigate to the **SpecCatcher** tab.

---

## 💡 How to use

1. **Start Capturing**: Open the DevTools panel and interact with your web application (log in, submit forms, fetch data). Endpoints will appear in the panel automatically.
2. **Explore Details**: Click on any captured endpoint to view its inferred request and response schemas, decoded JWTs, and headers.
3. **Filter the Noise**: Use the search bar, method/status pills, or the Smart Filter to focus only on the API calls you care about.
4. **Export**: 
   - Click the **Export OpenAPI** or **Export Postman** button.
   - Select the endpoints you wish to document using the checkboxes.
   - Confirm to download the generated `.json` file immediately.

---

## 🤝 Contributing & Feedback

I hope you find this tool useful for your studies, debugging sessions, and API integration work! 

If you encounter a bug, have a feature request, or just want to suggest an improvement, please feel free to **open an issue** or submit a pull request. All contributions are welcome!
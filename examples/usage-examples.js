// Example usage of the Mermaid Server API

const serverUrl = 'http://localhost:8080';

// Example 1: Convert to SVG using POST
async function exampleSVG() {
    const mermaidDiagram = `
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E
    `;

    try {
        const response = await fetch(`${serverUrl}/svg`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                mermaid: mermaidDiagram,
                theme: 'dark',
                backgroundColor: 'transparent'
            })
        });

        if (response.ok) {
            const svgContent = await response.text();
            console.log('SVG generated successfully');
            // You can now use svgContent in your application
            return svgContent;
        } else {
            const error = await response.json();
            console.error('Error:', error.error);
        }
    } catch (error) {
        console.error('Network error:', error.message);
    }
}

// Example 2: Convert to PNG with base64 response
async function examplePNGBase64() {
    const mermaidDiagram = `
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello Bob, how are you?
    B-->>A: Great thanks!
    `;

    try {
        const response = await fetch(`${serverUrl}/png`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                mermaid: mermaidDiagram,
                theme: 'forest',
                backgroundColor: 'white',
                width: 800,
                height: 600
            })
        });

        if (response.ok) {
            const result = await response.json();
            console.log('PNG generated successfully');
            console.log('Size:', result.size, 'bytes');
            
            // You can use the base64 data directly in HTML
            const imgElement = document.createElement('img');
            imgElement.src = `data:image/png;base64,${result.data}`;
            document.body.appendChild(imgElement);
            
            return result.data;
        } else {
            const error = await response.json();
            console.error('Error:', error.error);
        }
    } catch (error) {
        console.error('Network error:', error.message);
    }
}

// Example 3: Generate PNG URL for direct embedding
function examplePNGDirectURL() {
    const mermaidDiagram = `
pie title Pets adopted by volunteers
    "Dogs" : 386
    "Cats" : 85
    "Rats" : 15
    `;

    const params = new URLSearchParams({
        mermaid: mermaidDiagram,
        theme: 'default',
        backgroundColor: 'white'
    });

    const imageUrl = `${serverUrl}/png?${params.toString()}`;
    
    console.log('Direct PNG URL:', imageUrl);
    
    // You can use this URL directly in HTML
    const imgElement = document.createElement('img');
    imgElement.src = imageUrl;
    imgElement.alt = 'Mermaid Diagram';
    document.body.appendChild(imgElement);
    
    return imageUrl;
}

// Example 4: Create a simple helper function
function createMermaidImageElement(mermaidCode, options = {}) {
    const {
        theme = 'default',
        backgroundColor = 'white',
        width,
        height,
        alt = 'Mermaid Diagram'
    } = options;

    const params = new URLSearchParams({
        mermaid: mermaidCode,
        theme,
        backgroundColor
    });

    if (width) params.append('width', width);
    if (height) params.append('height', height);

    const imageUrl = `${serverUrl}/png?${params.toString()}`;
    
    const imgElement = document.createElement('img');
    imgElement.src = imageUrl;
    imgElement.alt = alt;
    imgElement.style.maxWidth = '100%';
    
    return imgElement;
}

// Usage example:
// const diagram = createMermaidImageElement('graph TD\nA-->B', { theme: 'dark' });
// document.body.appendChild(diagram);

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        exampleSVG,
        examplePNGBase64,
        examplePNGDirectURL,
        createMermaidImageElement
    };
}

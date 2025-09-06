# Mermaid Server API Examples using curl

# 1. Health Check
curl -X GET http://localhost:8080/health

# 2. Get API Documentation
curl -X GET http://localhost:8080/

# 3. GET SVG with Base64 encoded mermaid code
# First, encode your mermaid code to base64:
# echo -n "graph TD\n    A[Start] --> B[End]" | base64
# Result: Z3JhcGggVEQKICAgIEFbU3RhcnRdIC0tPiBCW0VuZF0=

curl -X GET "http://localhost:8080/svg?mmd=Z3JhcGggVEQKICAgIEFbU3RhcnRdIC0tPiBCW0VuZF0=" \
  -H "Accept: image/svg+xml" \
  -o diagram.svg

# 4. GET PNG with dark theme
curl -X GET "http://localhost:8080/png?mmd=Z3JhcGggVEQKICAgIEFbU3RhcnRdIC0tPiBCW0VuZF0=&theme=dark" \
  -H "Accept: image/png" \
  -o diagram.png

# 5. GET PNG with transparent background and custom size
curl -X GET "http://localhost:8080/png?mmd=Z3JhcGggVEQKICAgIEFbU3RhcnRdIC0tPiBCW0VuZF0=&bg=transparent&w=800&h=600" \
  -H "Accept: image/png" \
  -o diagram_transparent.png

# 6. POST to convert SVG
curl -X POST http://localhost:8080/convert/svg \
  -H "Content-Type: application/json" \
  -d '{
    "mermaid": "graph TD\n    A[Client] --> B[Load Balancer]\n    B --> C[Server01]\n    B --> D[Server02]",
    "theme": "dark",
    "backgroundColor": "white"
  }' \
  -o result.svg

# 7. POST to convert PNG (binary)
curl -X POST http://localhost:8080/convert/png \
  -H "Content-Type: application/json" \
  -d '{
    "mermaid": "sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello Bob\n    B-->>A: Hi Alice",
    "format": "binary",
    "theme": "forest"
  }' \
  -o result.png

# 8. POST to convert PNG (base64 JSON response)
curl -X POST http://localhost:8080/convert/png \
  -H "Content-Type: application/json" \
  -d '{
    "mermaid": "classDiagram\n    class Animal {\n        +String name\n        +makeSound()\n    }\n    class Dog {\n        +bark()\n    }\n    Animal <|-- Dog",
    "format": "base64",
    "backgroundColor": "transparent"
  }' \
  | jq .

# 9. Complex flowchart example
curl -X GET "http://localhost:8080/svg?mmd=$(echo -n 'flowchart TD
    A[Christmas] -->|Get money| B(Go shopping)
    B --> C{Let me think}
    C -->|One| D[Laptop]
    C -->|Two| E[iPhone]
    C -->|Three| F[fa:fa-car Car]' | base64 -w 0)" \
  -o flowchart.svg

# 10. Sequence diagram with multiple participants
SEQUENCE_BASE64=$(echo -n 'sequenceDiagram
    participant U as User
    participant C as Client
    participant S as Server
    participant D as Database
    
    U->>C: Login Request
    C->>S: Authentication
    S->>D: Query User
    D-->>S: User Data
    S-->>C: Auth Token
    C-->>U: Login Success' | base64 -w 0)

curl -X GET "http://localhost:8080/png?mmd=${SEQUENCE_BASE64}&theme=dark&bg=transparent" \
  -o sequence.png

# 11. Check cache statistics
curl -X GET http://localhost:8080/cache/stats | jq .

# 12. Clear cache
curl -X DELETE http://localhost:8080/cache | jq .

# 13. Entity Relationship Diagram
ERD_BASE64=$(echo -n 'erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
    
    CUSTOMER {
        string name
        string custNumber
        string sector
    }
    
    ORDER {
        int orderNumber
        string deliveryAddress
    }
    
    LINE-ITEM {
        string productCode
        int quantity
        float pricePerUnit
    }' | base64 -w 0)

curl -X GET "http://localhost:8080/svg?mmd=${ERD_BASE64}" \
  -o erd.svg

# Note: For Windows users using PowerShell, use this base64 encoding method:
# $mermaidCode = "graph TD`n    A[Start] --> B[End]"
# $base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($mermaidCode))
# curl -X GET "http://localhost:8080/svg?mmd=$base64" -o diagram.svg

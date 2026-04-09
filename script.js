document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('api-key');
    const connectBtn = document.getElementById('connect-btn');
    const connStatus = document.getElementById('connection-status');
    const statusDot = document.getElementById('status-dot');
    
    const settingsSection = document.getElementById('settings-section');
    const generatorSection = document.getElementById('generator-section');
    
    const modelSelect = document.getElementById('model-select');
    const sopInput = document.getElementById('sop-input');
    const generateBtn = document.getElementById('generate-btn');
    const generateStatus = document.getElementById('generate-status');
    const generateBtnText = generateBtn.querySelector('.btn-text');
    const generateLoader = generateBtn.querySelector('.loader');

    let currentApiKey = '';

    // Load saved API key
    const savedApiKey = localStorage.getItem('gemini_api_key');
    if (savedApiKey) {
        apiKeyInput.value = savedApiKey;
    }

    // 1. Connect API and fetch Models
    connectBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
            showConnMessage('Vui lòng nhập API Key', 'error');
            return;
        }

        connectBtn.disabled = true;
        connectBtn.textContent = "Đang kết nối...";
        showConnMessage('');

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
            
            if (!response.ok) {
                throw new Error(`Kết nối thất bại (Mã lỗi: ${response.status})`);
            }

            const data = await response.json();
            
            // Filter relevant text models
            const models = data.models.filter(m => 
                m.name.includes('gemini') && 
                !m.name.includes('vision') &&
                !m.name.includes('test') &&
                !m.name.includes('1.0') && // Exclude older models
                (m.supportedGenerationMethods || []).includes('generateContent')
            );

            if (models.length === 0) {
                showConnMessage('Không tìm thấy model phù hợp nào.', 'error');
                return;
            }

            // Populate select
            modelSelect.innerHTML = '';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.name; // usually "models/gemini-1.5-pro"
                opt.textContent = m.displayName || m.name.replace('models/', '');
                
                // Select gemini-1.5-pro or 1.5-flash by default if available
                if (m.name.includes('pro')) opt.selected = true;
                
                modelSelect.appendChild(opt);
            });

            // Enable generator section
            currentApiKey = key;
            localStorage.setItem('gemini_api_key', key);
            
            showConnMessage('Kết nối thành công!', 'success');
            statusDot.classList.add('connected');
            
            generatorSection.classList.remove('disabled-section');
            modelSelect.disabled = false;
            sopInput.disabled = false;
            generateBtn.disabled = false;

        } catch (error) {
            console.error(error);
            showConnMessage('Lỗi xác thực: Kiểm tra lại API Key', 'error');
            statusDot.classList.remove('connected');
            disableGenerator();
        } finally {
            connectBtn.disabled = false;
            connectBtn.textContent = "Kết Nối";
        }
    });

    // 2. Generate content
    generateBtn.addEventListener('click', async () => {
        const sopText = sopInput.value.trim();
        if (!sopText) {
            showGenMessage('Vui lòng nhập nội dung SOP', 'warning');
            sopInput.focus();
            return;
        }

        const modelName = modelSelect.value;
        if (!modelName) return;

        setLoadingState(true);
        showGenMessage('AI đang phân tích SOP và thiết kế sơ đồ...', '');

        try {
            const systemInstruction = `
You are an expert Diagram Architect capable of converting text descriptions (SOPs, workflows, processes) into draw.io XML diagrams.
Your task is to extract the logical steps linearly or with branches, and synthesize a valid draw.io XML representation.

Your output must ONLY be the raw XML content. 
Do not include markdown codeblocks (like \`\`\`xml or \`\`\`). 
Do not explain anything. 

Guidelines to build draw.io XML:
1. Always start with <mxGraphModel> and end with </mxGraphModel>. Output MUST be valid XML.
2. Inside <mxGraphModel>, include <root>.
3. The first two cells in <root> must be:
   <mxCell id="0" />
   <mxCell id="1" parent="0" />
4. Create geometric shapes for each step (<mxCell id="n" value="Step Text" vertex="1" parent="1">...) 
5. Create edges connecting the shapes (<mxCell id="e" value="" edge="1" parent="1" source="node1" target="node2">...)
6. Use appropriate visual styles in the 'style' attribute. For example:
   - Start/End blocks: rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;
   - Process blocks: rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;
   - Decision/Condition: rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;
   - Edges: edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;
7. Arrange the layout using <mxGeometry x="..." y="..." width="120" height="60" as="geometry" />. 
   - Calculate coordinates (x,y) properly so blocks do not overlap.
   - Standard layout: Flow from Top to Bottom, incrementing 'y' by 100 for each step.
   - Center 'x' at a fixed coordinate (e.g., 300) to keep simple workflows linear.
8. NEVER output anything outside the <mxGraphModel> root tags.
`;

            const payload = {
                systemInstruction: {
                    parts: [{ text: systemInstruction }]
                },
                contents: [{
                    role: "user",
                    parts: [{ text: `Convert this SOP into a draw.io flowchart diagram:\n\n${sopText}` }]
                }],
                generationConfig: {
                    temperature: 0.2
                }
            };

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${currentApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || 'Lỗi từ Gemini API');
            }

            const data = await response.json();
            let generatedXml = data.candidates[0]?.content?.parts[0]?.text || '';
            
            // Clean up if the AI still included markdown
            generatedXml = generatedXml.replace(/^```xml/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();

            if (!generatedXml.includes('<mxGraphModel')) {
                throw new Error('Đầu ra từ AI không phải là XML hợp lệ.');
            }

            showGenMessage('Tạo thành công. Đang mở Draw.io...', 'success');
            
            // 3. Compress and open
            openInDrawio(generatedXml);

        } catch (error) {
            console.error(error);
            showGenMessage(`Lỗi: ${error.message}`, 'error');
        } finally {
            setLoadingState(false);
        }
    });

    function openInDrawio(xml) {
        try {
            // STEP 1: URL Encode the XML
            const encoded = encodeURIComponent(xml);
            
            // STEP 2: Compress using raw deflate
            const compressed = pako.deflateRaw(encoded);
            
            // STEP 3: Convert to Base64
            // Since pako returns Uint8Array, convert to binary string then base64
            const base64 = btoa(Array.from(compressed, b => String.fromCharCode(b)).join(""));
            
            // STEP 4: Create the JSON object for the draw.io '#create' parameter
            const createObj = {
                type: "xml",
                compressed: true,
                data: base64
            };
            
            // STEP 5: Construct full URL and open
            const url = "https://app.diagrams.net/?pv=0&grid=0#create=" + encodeURIComponent(JSON.stringify(createObj));
            
            window.open(url, '_blank');
        } catch (err) {
            console.error('Compression Error:', err);
            showGenMessage('Có lỗi xảy ra trong quá trình nén và tạo URL Draw.io.', 'error');
        }
    }

    function showConnMessage(msg, type = '') {
        connStatus.textContent = msg;
        connStatus.className = 'status-msg ' + type;
    }

    function showGenMessage(msg, type = '') {
        generateStatus.textContent = msg;
        generateStatus.className = 'status-msg ' + type;
    }

    function disableGenerator() {
        generatorSection.classList.add('disabled-section');
        modelSelect.disabled = true;
        sopInput.disabled = true;
        generateBtn.disabled = true;
    }

    function setLoadingState(isLoading) {
        if (isLoading) {
            generateBtn.disabled = true;
            generateBtnText.classList.add('hidden');
            generateLoader.classList.remove('hidden');
        } else {
            generateBtn.disabled = false;
            generateBtnText.classList.remove('hidden');
            generateLoader.classList.add('hidden');
        }
    }
});

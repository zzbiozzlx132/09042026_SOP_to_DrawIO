document.addEventListener('DOMContentLoaded', () => {
    // Top-level DOM elements
    const apiKeyInput = document.getElementById('api-key');
    const connectBtn = document.getElementById('connect-btn');
    const connStatus = document.getElementById('connection-status');
    const statusDot = document.getElementById('status-dot');
    
    const sections = {
        settings: document.getElementById('settings-section'),
        chat: document.getElementById('chat-section'),
        generator: document.getElementById('generator-section')
    };
    
    const modelSelect = document.getElementById('model-select');
    
    // Chat DOM
    const chatWindow = document.getElementById('chat-window');
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const finalizeBtn = document.getElementById('finalize-btn');

    // Generator DOM
    const sopInput = document.getElementById('sop-input');
    const generateBtn = document.getElementById('generate-btn');
    const generateStatus = document.getElementById('generate-status');
    const generateLoader = document.getElementById('gen-loader');

    let currentApiKey = '';
    
    // Memory state for Chat (multi-turn)
    let chatHistory = [];

    // System prompt for the SOP framework
    const CHAT_SYSTEM_INSTRUCTION = `
Bạn là "Cố vấn Quy Trình (SOP Consultant)" của Kian. Nhiệm vụ của bạn là dẫn dắt người dùng xây dựng một quy trình chuẩn từ A-Z một cách CÓ CẤU TRÚC.
TUYỆT ĐỐI KHÔNG hỏi han miên man. Bạn phải phỏng vấn người dùng theo đúng 4 bước sau, đi từng bước một, không nhảy cóc:
1. (Purpose & Scope): Mục đích của quy trình này là gì? Phạm vi áp dụng?
2. (Roles): Những bộ phận/vai trò nào sẽ tham gia?
3. (Core Flow): Trình tự các bước Happy Path từ lúc bắt đầu tới kết thúc?
4. (Edge Cases): Những điểm rẽ nhánh, kiểm duyệt, hoặc xử lý lỗi (VD: nếu không duyệt thì quay lại bước nào)?

Sau khi đã thu thập đủ thông tin, bạn hãy TỔNG HỢP lại toàn bộ thành văn bản hoàn chỉnh cuối cùng.
Luôn giao tiếp tự nhiên, xúc tích, và thân thiện.
`;

    // Load saved API key
    const savedApiKey = localStorage.getItem('gemini_api_key');
    if (savedApiKey) apiKeyInput.value = savedApiKey;

    /* --------------------------------------------------------
       1. CONNECTION & INITIALIZATION
    -------------------------------------------------------- */
    connectBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        if (!key) return showStatus(connStatus, 'Vui lòng nhập API Key', 'error');

        connectBtn.disabled = true;
        connectBtn.textContent = 'Đang kết nối...';
        showStatus(connStatus, '');

        try {
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
            if (!resp.ok) throw new Error(`Lỗi HTTP: ${resp.status}`);
            
            const data = await resp.json();
            const models = data.models.filter(m => 
                m.name.includes('gemini') && !m.name.includes('vision') && 
                !m.name.includes('test') && !m.name.includes('1.0') && 
                (m.supportedGenerationMethods || []).includes('generateContent')
            );
            if (models.length === 0) throw new Error('Không có model văn bản phù hợp.');

            modelSelect.innerHTML = '';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.name;
                opt.textContent = m.displayName || m.name.replace('models/', '');
                if (m.name.includes('pro')) opt.selected = true;
                modelSelect.appendChild(opt);
            });

            currentApiKey = key;
            localStorage.setItem('gemini_api_key', key);
            
            showStatus(connStatus, 'Kết nối thành công!', 'success');
            statusDot.classList.add('connected');
            
            // Enable sections
            sections.chat.classList.remove('disabled-section');
            modelSelect.disabled = false;
            chatInput.disabled = false;
            sendChatBtn.disabled = false;
            finalizeBtn.disabled = false;

        } catch (error) {
            showStatus(connStatus, `Lỗi: ${error.message}`, 'error');
            statusDot.classList.remove('connected');
            sections.chat.classList.add('disabled-section');
            sections.generator.classList.add('disabled-section');
        } finally {
            connectBtn.disabled = false;
            connectBtn.textContent = 'Kết Nối';
        }
    });

    /* --------------------------------------------------------
       2. SOP ASSISTANT CHAT LOGIC
    -------------------------------------------------------- */
    sendChatBtn.addEventListener('click', async () => {
        const text = chatInput.value.trim();
        if (!text) return;
        
        // Append user message to UI and history
        addMessageToUI('user', text);
        chatHistory.push({ role: 'user', parts: [{ text }] });
        chatInput.value = '';
        
        await fetchChatReply();
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatBtn.click();
        }
    });

    async function fetchChatReply() {
        const modelName = modelSelect.value;
        if (!modelName) return;

        chatInput.disabled = true;
        sendChatBtn.disabled = true;
        
        const loaderId = appendTypingIndicator();

        try {
            const payload = {
                systemInstruction: { parts: [{ text: CHAT_SYSTEM_INSTRUCTION }] },
                contents: chatHistory,
                generationConfig: { temperature: 0.6 }
            };

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${currentApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('API request failed');
            const data = await response.json();
            const aiText = data.candidates[0]?.content?.parts[0]?.text || '...';
            
            // Append AI response to History and UI
            chatHistory.push({ role: 'model', parts: [{ text: aiText }] });
            removeTypingIndicator(loaderId);
            addMessageToUI('ai', aiText);

        } catch (err) {
            console.error(err);
            removeTypingIndicator(loaderId);
            addMessageToUI('ai', '🚫 Xin lỗi, có lỗi khi gọi API. Vui lòng thử lại!');
            // Pop the user request off history so they can retry
            chatHistory.pop(); 
        } finally {
            chatInput.disabled = false;
            sendChatBtn.disabled = false;
            chatInput.focus();
        }
    }

    function addMessageToUI(type, text) {
        const div = document.createElement('div');
        div.className = `chat-message ${type}-message`;
        const avatar = type === 'user' ? 'Tôi' : 'AI';
        div.innerHTML = `
            <div class="avatar">${avatar}</div>
            <div class="message-content">${escapeHTML(text)}</div>
        `;
        chatWindow.appendChild(div);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function appendTypingIndicator() {
        const id = 'typing-' + Date.now();
        const div = document.createElement('div');
        div.className = `chat-message ai-message`;
        div.id = id;
        div.innerHTML = `
            <div class="avatar">AI</div>
            <div class="message-content typing-indicator">
                <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
            </div>
        `;
        chatWindow.appendChild(div);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return id;
    }

    function removeTypingIndicator(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    /* --------------------------------------------------------
       3. FINALIZE & TRANSFER TO GENERATOR
    -------------------------------------------------------- */
    finalizeBtn.addEventListener('click', async () => {
        if (chatHistory.length === 0) {
            alert("Bạn chưa thảo luận gì với trợ lý cả!");
            return;
        }

        // Add visual cue
        finalizeBtn.disabled = true;
        finalizeBtn.textContent = 'Đang tự động đúc kết SOP...';

        // Prompt AI to summarize everything into a final SOP
        chatHistory.push({ role: 'user', parts: [{ text: "Hãy bỏ qua hội thoại, chốt lại toàn bộ những gì chúng ta đã thảo luận thành 1 văn bản Quy trình SOP tinh gọn, rõ ràng để dùng làm dữ liệu đầu vào sinh Lưu đồ XML. KHÔNG kèm câu từ thừa." }]});
        
        try {
            const payload = {
                systemInstruction: { parts: [{ text: "Your only job is to summarize the conversation into a final, clean, numbered SOP text." }] },
                contents: chatHistory,
            };

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${modelSelect.value}:generateContent?key=${currentApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            const finalSop = data.candidates[0]?.content?.parts[0]?.text || '';
            chatHistory.push({ role: 'model', parts: [{ text: finalSop }] });

            // Send to bottom textarea
            sopInput.value = finalSop;
            sections.generator.classList.remove('disabled-section');
            sopInput.disabled = false;
            generateBtn.disabled = false;
            
            // Scroll to it
            sections.generator.scrollIntoView({ behavior: 'smooth' });

        } catch (e) {
            alert('Lỗi đúc kết SOP: ' + e.message);
            chatHistory.pop();
        } finally {
            finalizeBtn.disabled = false;
            finalizeBtn.innerHTML = 'Chốt SOP & Vẽ Sơ Đồ 👇';
        }
    });

    /* --------------------------------------------------------
       4. GENERATE XML & PUSH TO DRAW.IO
    -------------------------------------------------------- */
    generateBtn.addEventListener('click', async () => {
        const sopText = sopInput.value.trim();
        if (!sopText) return showStatus(generateStatus, 'Vui lòng chốt hoặc nhập SOP', 'warning');

        setGeneratingState(true);
        showStatus(generateStatus, 'AI Kiến trúc sư đang dựng bản vẽ XML...', '');

        // Mở sẵn tab trắng để trình duyệt không chặn Popup do lệch thời gian (async blocker)
        const drawioTab = window.open('about:blank', '_blank');
        if (drawioTab) {
            drawioTab.document.write('<h2 style="font-family:sans-serif;text-align:center;margin-top:20vh;color:#333;">🚀 Đang phân tích và dựng mã kiến trúc Draw.io.<br>Vui lòng đợi vài giây...</h2>');
        }

        try {
            const ARCHITECT_PROMPT = `
You are an expert Diagram Architect capable of converting SOPs into draw.io XML flowcharts.
Your output must ONLY be the raw XML content. No markdown codeblocks (like \`\`\`xml). 

Rules:
1. Always start with <mxGraphModel> and end with </mxGraphModel>. 
2. Inside <mxGraphModel>, include <root>.
3. Top 2 cells: <mxCell id="0" /> and <mxCell id="1" parent="0" />
4. Shapes (<mxCell id="..." value="..." vertex="1" parent="1">). Assign standard styles (e.g., rhombus for conditions).
5. Edges (<mxCell id="..." edge="1" parent="1" source="..." target="...">). Apply edgeStyle=orthogonalEdgeStyle;
6. Auto-calculate x,y geometry so boxes don't overlap (spacing 100px normally).
7. Return raw XML ONLY.
`;

            const payload = {
                systemInstruction: { parts: [{ text: ARCHITECT_PROMPT }] },
                contents: [{ role: "user", parts: [{ text: `Generate pure, raw draw.io XML flowchart for this SOP:\n\n${sopText}` }] }],
                generationConfig: { temperature: 0.1 }
            };

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${modelSelect.value}:generateContent?key=${currentApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('Cổng Draw.io Bot từ chối kết nối');
            const data = await response.json();
            let xml = data.candidates[0]?.content?.parts[0]?.text || '';
            xml = xml.replace(/^```xml/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();

            if (!xml.includes('<mxGraphModel')) throw new Error('Đầu ra không là khuôn dạng mã XML hợp lệ');

            showStatus(generateStatus, 'Thành công! Đang chuyển hướng sang Draw.io...', 'success');
            
            // Pako compress and Base64 encode
            const encoded = encodeURIComponent(xml);
            const compressed = pako.deflateRaw(encoded);
            const base64 = btoa(Array.from(compressed, b => String.fromCharCode(b)).join(""));
            
            const createObj = { type: "xml", compressed: true, data: base64 };
            const finalUrl = "https://app.diagrams.net/?pv=0&grid=0#create=" + encodeURIComponent(JSON.stringify(createObj));
            
            if (drawioTab) {
                drawioTab.location.href = finalUrl;
            } else {
                window.open(finalUrl, '_blank');
            }

        } catch (err) {
            console.error(err);
            if (drawioTab) drawioTab.close();
            showStatus(generateStatus, `Lỗi Kiến Trúc Sơ Đồ: ${err.message}`, 'error');
        } finally {
            setGeneratingState(false);
        }
    });

    /* Utils */
    function showStatus(element, msg, type = '') {
        element.textContent = msg;
        element.className = 'status-msg ' + type;
    }
    function setGeneratingState(isGen) {
        generateBtn.disabled = isGen;
        document.querySelector('#generate-btn .btn-text').classList.toggle('hidden', isGen);
        generateLoader.classList.toggle('hidden', !isGen);
    }
    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag]));
    }
});

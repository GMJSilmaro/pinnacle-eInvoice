document.addEventListener('DOMContentLoaded', function() {
    // Reset the chat session on page load to ensure fresh context
    localStorage.removeItem('chatSessionId');
    
    // Load saved position settings if available
    loadPositionSettings();
    
    initChatAssistant();
});

// Configuration options for the chat assistant
const chatConfig = {
    position: {
        bottom: 10,
        right: 20
    },
    // Add other configuration options as needed
};

// Load position settings from localStorage
function loadPositionSettings() {
    const savedPosition = localStorage.getItem('chatAssistantPosition');
    if (savedPosition) {
        try {
            const position = JSON.parse(savedPosition);
            if (position && typeof position.bottom === 'number' && typeof position.right === 'number') {
                chatConfig.position = position;
            }
        } catch (e) {
            console.error('Error loading chat position settings:', e);
        }
    }
}

// Save position settings to localStorage
function savePositionSettings() {
    localStorage.setItem('chatAssistantPosition', JSON.stringify(chatConfig.position));
}

function initChatAssistant() {
    // Create chat container if it doesn't exist
    if (!document.querySelector('.ai-chat-container')) {
        createChatInterface();
    }
    
    // Apply position from configuration
    applyPositionConfig();
    
    // Generate a session ID for this chat session
    if (!localStorage.getItem('chatSessionId')) {
        localStorage.setItem('chatSessionId', generateSessionId());
    }
    
    const chatContainer = document.querySelector('.ai-chat-container');
    const chatHeader = document.querySelector('.chat-header');
    const chatMessages = document.querySelector('.chat-messages');
    const chatInput = document.querySelector('#chat-input');
    const sendButton = document.querySelector('#send-message');
    const chatToggleBtn = document.querySelector('.chat-toggle-btn');
    
    // Set initial toggle button visibility
    if (chatContainer.classList.contains('open')) {
        chatToggleBtn.style.display = 'none';
    } else {
        chatToggleBtn.style.display = 'flex';
    }
    
    // Toggle chat open/closed when header is clicked
    chatHeader.addEventListener('click', function(e) {
        // Don't toggle if clicking on the action buttons
        if (e.target.closest('.header-actions')) {
            return;
        }
        toggleChat();
    });
    
    // Chat toggle button (mobile)
    chatToggleBtn.addEventListener('click', function() {
        toggleChat();
    });
    
    // Close button
    document.querySelector('.chat-close').addEventListener('click', function() {
        chatContainer.classList.remove('open');
        chatToggleBtn.style.display = 'flex';
    });
    
    // Minimize button
    document.querySelector('.chat-minimize').addEventListener('click', function() {
        chatContainer.classList.remove('open');
        chatToggleBtn.style.display = 'flex';
    });
    
    // Reset button
    document.querySelector('.chat-reset').addEventListener('click', function() {
        // Add confirmation before resetting
        if (confirm('Are you sure you want to reset this conversation?')) {
            resetChat();
        }
    });
    
    // Send message on button click
    sendButton.addEventListener('click', sendMessage);
    
    // Send message on Enter key press
    chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Enable/disable send button based on input
    chatInput.addEventListener('input', function() {
        sendButton.disabled = chatInput.value.trim() === '';
    });
    
    // Initialize with a welcome message
    addMessage('assistant', 'Hello! I\'m your Pinnacle e-Invoice Portal AI assistant. I can help you with submitting Excel invoices, checking statuses, troubleshooting validation errors, and more. Feel free to ask me anything about the eInvoice Portal or click "Common Questions" below to see frequently asked questions about invoice processing.');
    
    // Add predefined question buttons
    addPredefinedQuestions();
}

// Apply position configuration to the chat elements
function applyPositionConfig() {
    const chatContainer = document.querySelector('.ai-chat-container');
    const chatToggleBtn = document.querySelector('.chat-toggle-btn');
    
    if (chatContainer && chatToggleBtn) {
        // Apply position to chat container
        chatContainer.style.bottom = `${chatConfig.position.bottom}px`;
        chatContainer.style.right = `${chatConfig.position.right}px`;
        
        // Apply same position to toggle button
        chatToggleBtn.style.bottom = `${chatConfig.position.bottom}px`;
        chatToggleBtn.style.right = `${chatConfig.position.right}px`;
    }
}

// Function to set a new position for the chat assistant
function setChatPosition(bottom, right) {
    chatConfig.position.bottom = bottom;
    chatConfig.position.right = right;
    applyPositionConfig();
    savePositionSettings();
}

function createChatInterface() {
    const chatHTML = `
        <div class="ai-chat-container">
            <div class="chat-header">
                <h5><i class="fas fa-robot"></i>Pinnacle Assistant</h5>
                <div class="header-actions">
                    <button class="chat-reset" title="Reset conversation"><i class="fas fa-redo-alt"></i></button>
                    <button class="chat-minimize" title="Minimize chat"><i class="fas fa-minus"></i></button>
                    <button class="chat-close" title="Close chat"><i class="fas fa-times"></i></button>
                </div>
            </div>
            <div class="chat-messages"></div>
            <div class="chat-input">
                <div class="input-group">
                    <input type="text" id="chat-input" placeholder="Ask about Pinnacle e-Invoice Portal..." aria-label="Chat message input" />
                    <button id="send-message" disabled title="Send message"><i class="fas fa-paper-plane"></i></button>
                </div>
                <button class="toggle-questions-btn" title="Show/hide common questions"><i class="fas fa-question-circle"></i> Common Questions</button>
                <div class="predefined-questions-container" style="display: none;"></div>
            </div>
        </div>
        <div class="chat-toggle-btn" title="Open chat assistant">
            <i class="fas fa-comment-dots"></i>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', chatHTML);
    
    // Add a context menu to the chat header for position adjustment
    const chatHeader = document.querySelector('.chat-header');
    chatHeader.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        showPositionConfigPanel(e.clientX, e.clientY);
    });
    
    // Add toggle functionality for questions
    const toggleQuestionsBtn = document.querySelector('.toggle-questions-btn');
    const questionsContainer = document.querySelector('.predefined-questions-container');
    
    toggleQuestionsBtn.addEventListener('click', function() {
        if (questionsContainer.style.display === 'none') {
            questionsContainer.style.display = 'block';
            toggleQuestionsBtn.classList.add('active');
        } else {
            questionsContainer.style.display = 'none';
            toggleQuestionsBtn.classList.remove('active');
        }
    });
}

// Show a simple position configuration panel
function showPositionConfigPanel(x, y) {
    // Remove any existing config panel
    const existingPanel = document.querySelector('.chat-config-panel');
    if (existingPanel) {
        existingPanel.remove();
    }
    
    // Create a new config panel
    const panel = document.createElement('div');
    panel.className = 'chat-config-panel';
    panel.style.position = 'fixed';
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.background = 'white';
    panel.style.border = '1px solid #ccc';
    panel.style.borderRadius = '4px';
    panel.style.padding = '10px';
    panel.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
    panel.style.zIndex = '2000';
    
    panel.innerHTML = `
        <div style="margin-bottom: 10px; font-weight: bold;">Adjust Position</div>
        <div style="margin-bottom: 8px;">
            <label style="display: block; margin-bottom: 4px;">Bottom (px):</label>
            <input type="number" id="chat-pos-bottom" value="${chatConfig.position.bottom}" style="width: 100%;">
        </div>
        <div style="margin-bottom: 8px;">
            <label style="display: block; margin-bottom: 4px;">Right (px):</label>
            <input type="number" id="chat-pos-right" value="${chatConfig.position.right}" style="width: 100%;">
        </div>
        <div style="display: flex; justify-content: space-between;">
            <button id="chat-pos-apply" style="padding: 4px 8px; background: #1e3a8a; color: white; border: none; border-radius: 4px; cursor: pointer;">Apply</button>
            <button id="chat-pos-cancel" style="padding: 4px 8px; background: #f0f0f0; border: 1px solid #ccc; border-radius: 4px; cursor: pointer;">Cancel</button>
        </div>
    `;
    
    document.body.appendChild(panel);
    
    // Add event listeners
    document.getElementById('chat-pos-apply').addEventListener('click', function() {
        const bottom = parseInt(document.getElementById('chat-pos-bottom').value) || 40;
        const right = parseInt(document.getElementById('chat-pos-right').value) || 30;
        setChatPosition(bottom, right);
        panel.remove();
    });
    
    document.getElementById('chat-pos-cancel').addEventListener('click', function() {
        panel.remove();
    });
    
    // Close panel when clicking outside
    document.addEventListener('click', function closePanel(e) {
        if (!panel.contains(e.target)) {
            panel.remove();
            document.removeEventListener('click', closePanel);
        }
    });
}

function toggleChat() {
    const chatContainer = document.querySelector('.ai-chat-container');
    const chatToggleBtn = document.querySelector('.chat-toggle-btn');
    
    chatContainer.classList.toggle('open');
    
    // Hide toggle button when chat is open, show when minimized
    if (chatContainer.classList.contains('open')) {
        chatToggleBtn.style.display = 'none';
        setTimeout(() => {
            document.querySelector('#chat-input').focus();
        }, 300); // Wait for animation to complete
    } else {
        chatToggleBtn.style.display = 'flex';
    }
}

function sendMessage(predefinedMessage = null) {
    const chatInput = document.querySelector('#chat-input');
    const sendButton = document.querySelector('#send-message');
    const message = predefinedMessage || chatInput.value.trim();
    
    if (!message) return;
    
    // Disable input and button while processing
    chatInput.disabled = true;
    sendButton.disabled = true;
    
    // Add user message to chat
    addMessage('user', message);
    
    // Clear input if it was a manually typed message
    if (!predefinedMessage) {
        chatInput.value = '';
    }
    
    // Show typing indicator
    showTypingIndicator();
    
    // Get session ID
    const sessionId = localStorage.getItem('chatSessionId') || generateSessionId();
    
    // Send to API
    fetch('/api/gemini/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            message,
            sessionId 
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        // Hide typing indicator
        hideTypingIndicator();
        
        if (data.success) {
            addMessage('assistant', data.response);
        } else {
            addMessage('assistant', 'Sorry, I encountered an error. Please try again later.');
            console.error('API Error:', data.error || data.message);
        }
    })
    .catch(error => {
        hideTypingIndicator();
        addMessage('assistant', 'Sorry, I couldn\'t connect to the server. Please try again later.');
        console.error('Network Error:', error);
    })
    .finally(() => {
        // Re-enable input and button
        chatInput.disabled = false;
        chatInput.focus();
        sendButton.disabled = chatInput.value.trim() === '';
    });
}

function resetChat() {
    // Clear chat messages
    const chatMessages = document.querySelector('.chat-messages');
    chatMessages.innerHTML = '';
    
    // Generate a new session ID
    localStorage.setItem('chatSessionId', generateSessionId());
    
    // Add welcome message
    addMessage('assistant', 'Chat has been reset. I\'m your Pinnacle e-Invoice Portal AI assistant. I can help you with submitting Excel invoices, checking statuses, troubleshooting validation errors, and more. Feel free to ask me anything about the eInvoice Portal or click "Common Questions" below to see frequently asked questions about invoice processing.');
    
    // Re-add predefined questions
    addPredefinedQuestions();
}

function addPredefinedQuestions() {
    // Define common questions based on actual functionality in inbound-excel.js and outbound-excel.js
    const questionCategories = [
        {
            name: "Outbound Invoices",
            questions: [
                "How do I submit an Excel invoice to LHDN?",
                "How do I cancel a submitted document?",
                "What do the different status colors mean?",
                "How do I export selected invoices?",
                "How do I validate my Excel file before submission?"
            ]
        },
        {
            name: "Inbound Invoices",
            questions: [
                "How do I view invoice details?",
                "How do I check if my data is up to date?",
                "How do I export invoice data to CSV?",
                "What do the document type icons mean?",
                "How do I copy invoice information?"
            ]
        },
        {
            name: "Troubleshooting",
            questions: [
                "What should I do if validation fails?",
                "How do I resolve EXCEL/OUTBOUND validation errors?",
                "Why is my submission rejected by LHDN?",
                "How do I check validation results?",
                "What are the next steps if I get an error?"
            ]
        }
    ];
    
    // Create container for predefined questions
    const container = document.createElement('div');
    container.className = 'predefined-questions';
    container.setAttribute('aria-label', 'Suggested questions');
    
    // Create sections for each category
    questionCategories.forEach(category => {
        // Add category label
        const categoryLabel = document.createElement('div');
        categoryLabel.className = 'question-category';
        categoryLabel.textContent = category.name;
        container.appendChild(categoryLabel);
        
        // Add questions for this category
        category.questions.forEach(question => {
            const button = document.createElement('button');
            button.className = 'question-button';
            button.textContent = question;
            button.setAttribute('aria-label', `Ask: ${question}`);
            button.addEventListener('click', () => {
                sendMessage(question);
                // Hide questions after selection
                document.querySelector('.predefined-questions-container').style.display = 'none';
                document.querySelector('.toggle-questions-btn').classList.remove('active');
            });
            container.appendChild(button);
        });
    });
    
    // Add to questions container
    const questionsContainer = document.querySelector('.predefined-questions-container');
    questionsContainer.innerHTML = ''; // Clear existing content
    questionsContainer.appendChild(container);
}

function addMessage(type, text) {
    const chatMessages = document.querySelector('.chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `message-${type}`);
    
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.innerHTML = `
        <div class="message-content">${formatMessage(text)}</div>
        <div class="message-time">${timeString}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
    
    // Scroll to bottom
    scrollToBottom();
}

function formatMessage(text) {
    // Enhanced markdown-like formatting
    return text
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function showTypingIndicator() {
    const chatMessages = document.querySelector('.chat-messages');
    const typingDiv = document.createElement('div');
    typingDiv.classList.add('typing-indicator');
    typingDiv.innerHTML = '<span></span><span></span><span></span>';
    typingDiv.id = 'typing-indicator';
    chatMessages.appendChild(typingDiv);
    scrollToBottom();
}

function hideTypingIndicator() {
    const typingIndicator = document.querySelector('#typing-indicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

function scrollToBottom() {
    const chatMessages = document.querySelector('.chat-messages');
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function generateSessionId() {
    // Generate a random session ID
    return 'session_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
} 
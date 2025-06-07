
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

// --- Interfaces for ChatGPT Data ---
interface RawChatMessageContent {
  content_type: string;
  parts?: string[];
  text?: string; // Sometimes text is directly here
}

interface RawChatMessageAuthor {
  role: string;
  name?: string | null;
  metadata?: Record<string, any> | null;
}

interface RawChatMessage {
  id: string;
  author: RawChatMessageAuthor;
  create_time?: number | null;
  content: RawChatMessageContent;
  metadata?: { is_visually_hidden_from_conversation?: boolean, [key: string]: any };
  // Other fields like status, end_turn, weight, recipient might exist
}

interface RawChatNode {
  id: string; // node_id
  message: RawChatMessage | null;
  parent: string | null;
  children: string[];
}

interface RawConversation {
  id: string; // conversation_id
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, RawChatNode>;
  current_node?: string | null;
  // Other fields like moderation_results, plugin_ids etc. might exist
}

// --- Interfaces for Processed Data ---
interface Message {
  id: string;
  authorRole: string;
  contentText: string;
  createTime?: number;
}

interface ProcessedConversation {
  id: string;
  title: string;
  createTime: number;
  updateTime: number;
  messages: Message[];
  summary: string;
  originalData: RawConversation; // Keep original for export
}

// --- Helper Functions ---
const generateSummary = (title: string, messages: Message[]): string => {
  const genericTitles = ["new chat", "empty chat", "untitled conversation"];
  if (title && !genericTitles.includes(title.toLowerCase())) {
    return title.substring(0, 150) + (title.length > 150 ? "..." : "");
  }
  const firstUserMessage = messages.find(m => m.authorRole === 'user' && m.contentText);
  if (firstUserMessage) {
    return firstUserMessage.contentText.substring(0, 100) + (firstUserMessage.contentText.length > 100 ? "..." : "");
  }
  const firstAssistantMessage = messages.find(m => m.authorRole === 'assistant' && m.contentText);
  if (firstAssistantMessage) {
    return firstAssistantMessage.contentText.substring(0, 100) + (firstAssistantMessage.contentText.length > 100 ? "..." : "");
  }
  return title || "No summary available";
};

const sanitizeFilename = (name: string): string => {
  if (!name) return 'untitled_conversation';
  // Replace spaces with underscores and remove characters not suitable for filenames
  return name
    .replace(/\s+/g, '_')
    .replace(/[/\\?%*:|"<>]/g, '')
    .substring(0, 100); // Limit length to avoid overly long filenames
};


const App: React.FC = () => {
  const [rawConversations, setRawConversations] = useState<RawConversation[]>([]);
  const [processedConversations, setProcessedConversations] = useState<ProcessedConversation[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<ProcessedConversation[]>([]);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [initialCount, setInitialCount] = useState<number>(0);

  const parseConversations = useCallback((jsonData: any): ProcessedConversation[] => {
    if (!Array.isArray(jsonData)) {
      throw new Error("Invalid format: Expected an array of conversations.");
    }

    return jsonData.map((conv: RawConversation, index: number) => {
      if (!conv.id || !conv.mapping) {
         console.warn("Skipping conversation due to missing id or mapping:", conv.title || `Untitled Conv ${index}`);
         return null; 
      }
      const messages: Message[] = [];
      Object.values(conv.mapping).forEach(node => {
        if (node && node.message && node.message.content && (node.message.content.parts || node.message.content.text)) {
           if (node.message.metadata?.is_visually_hidden_from_conversation) {
            return; 
          }
          const textContent = node.message.content.parts ? node.message.content.parts.join('') : (node.message.content.text || '');
          if (textContent.trim() === '') return; 

          messages.push({
            id: node.message.id,
            authorRole: node.message.author.role,
            contentText: textContent,
            createTime: node.message.create_time || undefined,
          });
        }
      });

      messages.sort((a, b) => (a.createTime || 0) - (b.createTime || 0));
      
      const title = conv.title || "Untitled Conversation";
      return {
        id: conv.id || `generated-id-${index}`,
        title: title,
        createTime: conv.create_time,
        updateTime: conv.update_time,
        messages,
        summary: generateSummary(title, messages),
        originalData: conv,
      };
    }).filter(Boolean) as ProcessedConversation[];
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setRawConversations([]);
    setProcessedConversations([]);
    setFilteredConversations([]);
    setSelectedConversationIds(new Set());
    setInitialCount(0);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const jsonData = JSON.parse(text);
        const parsed = parseConversations(jsonData);
        setRawConversations(jsonData); 
        setProcessedConversations(parsed);
        setInitialCount(parsed.length);
        setIsLoading(false);
      } catch (err) {
        console.error("Error processing file:", err);
        setError(`Failed to parse file: ${err instanceof Error ? err.message : String(err)}`);
        setIsLoading(false);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file.');
      setIsLoading(false);
    };
    reader.readAsText(file);
    event.target.value = ''; 
  };

  useEffect(() => {
    if (!searchTerm) {
      setFilteredConversations(processedConversations);
      return;
    }
    const lowerSearchTerm = searchTerm.toLowerCase();
    const filtered = processedConversations.filter(conv =>
      conv.title.toLowerCase().includes(lowerSearchTerm) ||
      conv.summary.toLowerCase().includes(lowerSearchTerm) ||
      conv.messages.some(msg => msg.contentText.toLowerCase().includes(lowerSearchTerm))
    );
    setFilteredConversations(filtered);
  }, [searchTerm, processedConversations]);

  const toggleSelection = (id: string) => {
    setSelectedConversationIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedConversationIds(prev => {
        const newSet = new Set(prev);
        filteredConversations.forEach(conv => newSet.add(conv.id));
        return newSet;
    });
  };

  const handleClearSelection = () => {
    setSelectedConversationIds(new Set());
  };

  const exportConversations = (conversationsToExport: ProcessedConversation[], filename: string) => {
    if (conversationsToExport.length === 0) {
      alert("No conversations to export for this selection.");
      return;
    }
    const dataToExport = conversationsToExport.map(pc => pc.originalData);
    const jsonString = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportSelected = () => {
    const selected = processedConversations.filter(conv => selectedConversationIds.has(conv.id));
    exportConversations(selected, 'selected_collection.json');
  };

  const handleExportUnselected = () => {
    const unselected = processedConversations.filter(conv => !selectedConversationIds.has(conv.id));
    exportConversations(unselected, 'unselected_conversations.json');
  };
  
  const stats = useMemo(() => ({
    total: initialCount,
    processed: processedConversations.length,
    displayed: filteredConversations.length,
    selected: selectedConversationIds.size,
  }), [initialCount, processedConversations.length, filteredConversations.length, selectedConversationIds.size]);


  return (
    <div className="min-h-screen container mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-8">
        <h1 className="text-4xl font-bold text-center text-blue-400 mb-2">ChatTown</h1>
        <p className="text-center text-gray-400 mb-6">Manage and Clean Your ChatGPT Conversations</p>

        <div className="bg-gray-800 p-4 sm:p-6 rounded-xl shadow-2xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center mb-4">
            <div className="flex justify-center md:justify-start">
              <label htmlFor="file-upload" className="file-input-label shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50">
                Upload conversations.json
              </label>
              <input id="file-upload" type="file" accept=".json" onChange={handleFileUpload} className="hidden" aria-label="Upload conversations.json file"/>
            </div>
            
            <div className="flex justify-center">
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full max-w-md bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-400 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 shadow-sm"
                aria-label="Search conversations"
              />
            </div>

            <div className="flex flex-col sm:flex-row justify-center md:justify-end gap-2">
               <button
                onClick={handleSelectAllVisible}
                disabled={filteredConversations.length === 0 || isLoading}
                className="bg-gray-500 hover:bg-gray-600 disabled:bg-gray-700 text-white font-semibold py-2 px-3 text-sm rounded-lg shadow-md hover:shadow-lg transition duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50"
                aria-label="Select all visible conversations"
              >
                Select All Visible
              </button>
              <button
                onClick={handleClearSelection}
                disabled={selectedConversationIds.size === 0 || isLoading}
                className="bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-700 text-white font-semibold py-2 px-3 text-sm rounded-lg shadow-md hover:shadow-lg transition duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-opacity-50"
                aria-label="Clear current selection"
              >
                Clear Selection
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
             <div className="flex justify-center md:justify-start">
                <button
                    onClick={handleExportSelected}
                    disabled={selectedConversationIds.size === 0 || isLoading}
                    className="bg-green-500 hover:bg-green-600 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:shadow-lg transition duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50 w-full sm:w-auto"
                    aria-label="Export selected conversations"
                >
                    Export Selected ({selectedConversationIds.size})
                </button>
             </div>
             <div className="flex justify-center md:justify-end">
                <button
                    onClick={handleExportUnselected}
                    disabled={processedConversations.length === 0 || (processedConversations.length > 0 && selectedConversationIds.size === processedConversations.length) || isLoading}
                    className="bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:shadow-lg transition duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-50 w-full sm:w-auto"
                    aria-label="Export unselected conversations"
                >
                    Export Unselected ({processedConversations.length > 0 ? processedConversations.length - selectedConversationIds.size : 0})
                </button>
            </div>
          </div>
          <div className="mt-4 text-center md:text-left text-xs sm:text-sm text-gray-400 grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2">
            <span>Total: {stats.total}</span>
            <span>Processed: {stats.processed}</span>
            <span>Displayed: {stats.displayed}</span>
            <span className="font-semibold text-blue-300">Selected: {stats.selected}</span>
          </div>
        </div>
      </header>

      {isLoading && <p className="text-center text-xl text-blue-300 py-10" aria-live="polite">Loading and processing file...</p>}
      {error && <p className="text-center text-red-400 bg-red-900 bg-opacity-30 p-3 rounded-md my-4" role="alert">{error}</p>}

      {!isLoading && !error && processedConversations.length === 0 && initialCount > 0 && (
         <p className="text-center text-gray-400 py-10">No conversations to display. All might have been filtered, or there was an issue with parsing specific entries.</p>
      )}
      {!isLoading && !error && initialCount === 0 && !rawConversations.length && (
         <p className="text-center text-gray-400 py-10">Upload a `conversations.json` file to get started.</p>
      )}


      <main className="space-y-4">
        {filteredConversations.map((conv) => (
          <ConversationItem 
            key={conv.id} 
            conversation={conv} 
            isSelected={selectedConversationIds.has(conv.id)}
            onToggleSelect={toggleSelection}
          />
        ))}
      </main>
      
      <footer className="mt-12 text-center text-sm text-gray-500">
        <p>&copy; {new Date().getFullYear()} ChatTown. Built for you.</p>
      </footer>
    </div>
  );
};

interface ConversationItemProps {
  conversation: ProcessedConversation;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}

const ConversationItem: React.FC<ConversationItemProps> = ({ conversation, isSelected, onToggleSelect }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  // Removed isCopied state

  const handleExportAsTextFile = () => {
    const instruction = "Summarize the following GPT conversation for easy copy-paste into an Obsidian note.";
    
    const formattedMessages = conversation.messages.map(msg => {
      return `${msg.authorRole.toUpperCase()}: ${msg.contentText}`;
    }).join('\n\n');

    const stringToExport = `${instruction}\n\n---\n\n${formattedMessages}`;
    
    const filename = `ChatTown_Obsidian_${sanitizeFilename(conversation.title || conversation.id)}.txt`;

    const blob = new Blob([stringToExport], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    // No need to alert or set 'isCopied' state, browser download is feedback.
  };

  return (
    <article 
      className={`p-4 rounded-lg shadow-xl hover:shadow-2xl transition-all duration-300 ease-in-out ${isSelected ? 'bg-blue-900 ring-2 ring-blue-500' : 'bg-gray-800'}`} 
      aria-labelledby={`conv-title-${conversation.id}`}
    >
      <div className="flex justify-between items-start">
        <div className="flex items-start flex-grow">
          <input 
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(conversation.id)}
            className="form-checkbox h-5 w-5 text-blue-500 bg-gray-700 border-gray-600 rounded focus:ring-blue-400 mr-3 mt-1 flex-shrink-0"
            aria-label={`Select conversation titled ${conversation.title}`}
          />
          <div className="flex-grow">
            <h2 id={`conv-title-${conversation.id}`} className="text-lg font-semibold text-blue-300 mb-1">{conversation.title}</h2>
            <p className="text-xs text-gray-500 mb-2">
              Created: {new Date(conversation.createTime * 1000).toLocaleString()} | Updated: {new Date(conversation.updateTime * 1000).toLocaleString()}
            </p>
            <p className="text-sm text-gray-300 mb-3">{conversation.summary}</p>
          </div>
        </div>
        <button
          onClick={handleExportAsTextFile}
          className={`p-1 rounded-md focus:outline-none focus:ring-2 focus:ring-opacity-75 ml-2 flex-shrink-0 transition-colors duration-150 ease-in-out
            ${isSelected ? 'text-blue-300' : 'text-gray-400'} hover:text-teal-400 focus:ring-teal-500
            `}
          aria-label={`Export conversation '${conversation.title}' for Obsidian as text file`}
        >
          {/* Download Icon SVG */}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M12 2.25a.75.75 0 01.75.75v11.69l3.22-3.22a.75.75 0 111.06 1.06l-4.5 4.5a.75.75 0 01-1.06 0l-4.5-4.5a.75.75 0 111.06-1.06l3.22 3.22V3a.75.75 0 01.75-.75zm-9 13.5a.75.75 0 01.75.75v2.25a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5V16.5a.75.75 0 011.5 0v2.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V16.5a.75.75 0 01.75-.75z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-xs text-blue-400 hover:text-blue-300 mt-2"
        aria-expanded={isExpanded}
        aria-controls={`conv-details-${conversation.id}`}
      >
        {isExpanded ? 'Show Less' : 'Show More Details'}
      </button>
      {isExpanded && (
        <div id={`conv-details-${conversation.id}`} className="mt-3 pt-3 border-t border-gray-700 max-h-96 overflow-y-auto pr-2">
          <h3 className="text-md font-semibold text-gray-300 mb-2">Messages:</h3>
          {conversation.messages.length > 0 ? (
            conversation.messages.map((msg, index) => (
              <div key={msg.id || `msg-${index}`} className={`mb-2 p-2 rounded-md ${msg.authorRole === 'user' ? (isSelected ? 'bg-blue-800' : 'bg-gray-700') : (isSelected ? 'bg-sky-700' : 'bg-gray-600')}`}>
                <p className={`text-xs font-semibold ${msg.authorRole === 'user' ? 'text-blue-300' : 'text-green-300'}`}>{msg.authorRole.toUpperCase()}</p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">{msg.contentText}</p>
                {msg.createTime && <p className="text-xs text-gray-500 mt-1">{new Date(msg.createTime * 1000).toLocaleString()}</p>}
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-400">No messages found or extracted for this conversation.</p>
          )}
        </div>
      )}
    </article>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
} else {
  console.error('Failed to find the root element');
}

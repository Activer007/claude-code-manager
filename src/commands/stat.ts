import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

interface HistoryItem {
  display: string;
}

interface SessionMessage {
  type: string;
  message?: {
    role: string;
    content: string | Array<{
      type: string;
      text?: string;
      name?: string;
      input?: any;
      thinking?: string;
    }>;
  };
  timestamp: string;
  uuid: string;
}

interface ConversationPair {
  userPrompt: string;
  claudeResponse?: string;
  timestamp: string;
}

interface ProjectData {
  history?: HistoryItem[];
  [key: string]: any;
}

interface ClaudeData {
  projects: Record<string, ProjectData>;
}

interface ProcessedProject {
  path: string;
  totalSize: number;
  historyItems: Array<{
    display: string;
    size: number;
  }>;
}

function lpad(str: string, length: number, padChar: string = '0'): string {
  return str.length < length ? padChar.repeat(length - str.length) + str : str;
}

function getCurrentDirectory(): string {
  return process.cwd();
}

function findClaudeDataFile(): string | null {
  const homeDir = os.homedir();
  return path.join(homeDir, ".claude.json");
}

function parseSortBy(sortBy: string): { method: 'ascii' | 'size'; ascending: boolean } {
  const trimmed = sortBy.trim();
  
  if (trimmed.startsWith('+')) {
    const method = trimmed.slice(1) as 'ascii' | 'size';
    return { method: method === 'ascii' || method === 'size' ? method : 'ascii', ascending: true };
  }
  
  if (trimmed.startsWith('-')) {
    const method = trimmed.slice(1) as 'ascii' | 'size';
    return { method: method === 'ascii' || method === 'size' ? method : 'ascii', ascending: false };
  }
  
  const method = trimmed as 'ascii' | 'size';
  return { method: method === 'ascii' || method === 'size' ? method : 'ascii', ascending: true };
}

function findSessionFiles(projectPath: string): string[] {
  const homeDir = os.homedir();
  const encodedPath = projectPath.replace(/\//g, '-').replace(/\./g, '-');
  const sessionDir = path.join(homeDir, '.claude', 'projects', encodedPath);
  
  try {
    if (!fs.existsSync(sessionDir)) {
      return [];
    }
    
    return fs.readdirSync(sessionDir)
      .filter(file => file.endsWith('.jsonl'))
      .map(file => path.join(sessionDir, file));
  } catch (error) {
    return [];
  }
}

function readSessionMessages(filePath: string): SessionMessage[] {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    
    return lines
      .map(line => {
        try {
          return JSON.parse(line) as SessionMessage;
        } catch {
          return null;
        }
      })
      .filter((msg): msg is SessionMessage => msg !== null);
  } catch (error) {
    return [];
  }
}

function getToolActionDescription(toolName: string, count: number): string {
  const descriptions: Record<string, string> = {
    'Read': count === 1 ? 'Read 1 file' : `Read ${count} files`,
    'Edit': count === 1 ? 'Made 1 code edit' : `Made ${count} code edits`,
    'Write': count === 1 ? 'Created 1 new file' : `Created ${count} new files`,
    'Bash': count === 1 ? 'Ran 1 command' : `Ran ${count} commands`,
    'Grep': count === 1 ? 'Searched 1 pattern' : `Searched ${count} patterns`,
    'Glob': count === 1 ? 'Found files matching 1 pattern' : `Found files matching ${count} patterns`,
    'LS': count === 1 ? 'Listed 1 directory' : `Listed ${count} directories`,
    'TodoWrite': count === 1 ? 'Updated task list' : `Updated task list ${count} times`,
    'Task': count === 1 ? 'Delegated 1 subtask' : `Delegated ${count} subtasks`
  };
  
  return descriptions[toolName] || `Used ${toolName} tool ${count} time${count > 1 ? 's' : ''}`;
}

function extractRelevantParams(toolName: string, input: any): string[] {
  const params: string[] = [];
  
  if (toolName === 'Read' && input.file_path) {
    const fileName = input.file_path.split('/').pop();
    params.push(`📄 ${fileName}`);
  } else if (toolName === 'Edit' && input.file_path) {
    const fileName = input.file_path.split('/').pop();
    params.push(`✏️ ${fileName}`);
  } else if (toolName === 'Write' && input.file_path) {
    const fileName = input.file_path.split('/').pop();
    params.push(`📝 ${fileName}`);
  } else if (toolName === 'Bash' && input.command) {
    const shortCmd = input.command.length > 50 ? input.command.substring(0, 50) + '...' : input.command;
    params.push(`💻 \`${shortCmd}\``);
  } else if (toolName === 'Grep' && input.pattern) {
    params.push(`🔍 Pattern: "${input.pattern}"`);
  } else if (toolName === 'Glob' && input.pattern) {
    params.push(`🗂️ Pattern: "${input.pattern}"`);
  }
  
  return params;
}

function extractConversationPairs(projectPath: string): ConversationPair[] {
  const sessionFiles = findSessionFiles(projectPath);
  const allMessages: SessionMessage[] = [];
  
  // Read all session files and combine messages
  for (const filePath of sessionFiles) {
    const messages = readSessionMessages(filePath);
    allMessages.push(...messages);
  }
  
  // Sort by timestamp
  allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  const pairs: ConversationPair[] = [];
  let currentUserPrompt: string | null = null;
  let currentTimestamp: string | null = null;
  
  let currentAssistantContent: string[] = [];
  let isCollectingAssistantResponse = false;
  
  for (const message of allMessages) {
    if (message.type === 'user' && message.message?.role === 'user') {
      // If we were collecting assistant responses, finalize the previous pair
      if (currentUserPrompt && currentAssistantContent.length > 0) {
        pairs.push({
          userPrompt: currentUserPrompt,
          claudeResponse: currentAssistantContent.join('\n\n'),
          timestamp: currentTimestamp || message.timestamp
        });
        currentUserPrompt = null;
        currentTimestamp = null;
        currentAssistantContent = [];
        isCollectingAssistantResponse = false;
      }
      
      // Extract user prompt
      const content = message.message.content;
      if (content) {
        let textContent: string | undefined;
        
        if (typeof content === 'string') {
          textContent = content;
        } else if (Array.isArray(content) && content.length > 0) {
          textContent = content.find(c => c.type === 'text')?.text;
        }
        
        if (textContent) {
          currentUserPrompt = textContent;
          currentTimestamp = message.timestamp;
        }
      }
    } else if (message.type === 'assistant' && message.message?.role === 'assistant') {
      isCollectingAssistantResponse = true;
      
      // Extract Claude response content
      const content = message.message.content;
      if (content && Array.isArray(content)) {
        for (const item of content) {
          if (item.type === 'text' && item.text) {
            currentAssistantContent.push(JSON.stringify({ type: 'text', content: item.text }));
          } else if (item.type === 'tool_use') {
            currentAssistantContent.push(JSON.stringify({ 
              type: 'tool_use', 
              tool: item.name, 
              input: item.input 
            }));
          } else if (item.type === 'thinking' && (item as any).thinking) {
            currentAssistantContent.push(JSON.stringify({ 
              type: 'thinking', 
              content: (item as any).thinking 
            }));
          }
        }
      } else if (typeof content === 'string') {
        currentAssistantContent.push(JSON.stringify({ type: 'text', content: content }));
      }
    } else if (message.type === 'system') {
      // Handle system messages
      if (isCollectingAssistantResponse) {
        currentAssistantContent.push(JSON.stringify({
          type: 'system',
          content: (message as any).content,
          meta: (message as any).isMeta || false,
          level: (message as any).level || 'info'
        }));
      }
    } else if (message.type === 'summary') {
      // Handle summary messages
      if (isCollectingAssistantResponse) {
        currentAssistantContent.push(JSON.stringify({
          type: 'summary',
          summary: (message as any).summary
        }));
      }
    }
  }
  
  // Add any remaining conversation pair
  if (currentUserPrompt) {
    pairs.push({
      userPrompt: currentUserPrompt,
      claudeResponse: currentAssistantContent.length > 0 ? currentAssistantContent.join('\n\n') : undefined,
      timestamp: currentTimestamp || allMessages[allMessages.length - 1]?.timestamp || ''
    });
  }
  
  return pairs;
}


export async function statCommand(options: { width?: string; sortBy?: string; historyOrder?: string; current?: boolean; fullMessage?: boolean; analyzer?: boolean; withAi?: boolean; outputPath?: string; outputFormat?: string }) {
  // If analyzer option is used, redirect to dashboard command
  if (options.analyzer) {
    console.log(chalk.yellow('📊 The --analyzer option has been moved to the unified dashboard'));
    console.log(chalk.cyan('🚀 Redirecting to: ccm dashboard'));
    console.log();
    
    // Import and execute dashboard command
    const { dashboardCommand } = require('./dashboard');
    await dashboardCommand({});
    return;
  }
  
  const width = parseInt(options.width || '80', 10);
  const { method, ascending } = parseSortBy(options.sortBy || 'ascii');
  const historyOrder = options.historyOrder || 'reverse';
  
  try {
    const dataFilePath = findClaudeDataFile();
    if (!dataFilePath) {
      console.error(chalk.red('No Claude data file found in home directory'));
      process.exit(1);
    }
    
    const rawData = fs.readFileSync(dataFilePath, 'utf8');
    const data: ClaudeData = JSON.parse(rawData);
    
    if (!data.projects) {
      console.log(chalk.yellow('No projects found in Claude data'));
      return;
    }
    
    // Process projects
    let projectEntries = Object.entries(data.projects);
    
    // Filter for current project if --current flag is set
    if (options.current) {
      const currentDir = getCurrentDirectory();
      projectEntries = projectEntries.filter(([projectPath]) => projectPath === currentDir);
    }
    
    const projects: ProcessedProject[] = projectEntries
      .map(([projectPath, projectData]) => {
        const historyItems = (projectData.history || []).map(item => ({
          display: item.display,
          size: JSON.stringify(item).length
        }));
        
        return {
          path: projectPath,
          totalSize: JSON.stringify(projectData).length,
          historyItems
        };
      })
      .sort((a, b) => {
        if (method === 'size') {
          return ascending ? a.totalSize - b.totalSize : b.totalSize - a.totalSize;
        } else {
          return ascending ? a.path.localeCompare(b.path) : b.path.localeCompare(a.path);
        }
      });
    
    // If output export is requested, handle export and return
    if (options.outputPath) {
      // Validate output format
      const outputFormat = options.outputFormat || 'json';
      if (!['json', 'markdown'].includes(outputFormat)) {
        console.error(chalk.red(`❌ Invalid output format: ${outputFormat}. Supported formats: json, markdown`));
        process.exit(1);
      }
      
      // Handle directory input with auto-naming
      let outputPath = options.outputPath;
      
      // Check if the path is a directory
      let isDirectory = false;
      try {
        const stat = fs.lstatSync(outputPath);
        isDirectory = stat.isDirectory();
      } catch {
        // Path doesn't exist, check if it ends with / or looks like a directory
        isDirectory = outputPath.endsWith('/') || outputPath.endsWith(path.sep);
      }
      
      if (isDirectory) {
        // Generate filename based on export options
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const timeStr = new Date().toISOString().split('T')[1].substring(0, 8).replace(/:/g, '');
        
        let filename = 'ccm-export';
        
        if (options.current) {
          const currentDir = getCurrentDirectory();
          const projectName = path.basename(currentDir);
          filename += `-${projectName}`;
        } else {
          filename += '-all-projects';
        }
        
        if (options.withAi) {
          filename += '-conversations';
        } else {
          filename += '-history';
        }
        
        filename += `-${timestamp}-${timeStr}.${outputFormat === 'json' ? 'json' : 'md'}`;
        
        // Ensure directory exists
        if (!fs.existsSync(outputPath)) {
          fs.mkdirSync(outputPath, { recursive: true });
        }
        
        outputPath = path.join(outputPath, filename);
        console.log(chalk.blue(`📁 Auto-generated filename: ${filename}`));
      }
      
      if (outputFormat === 'json') {
        // JSON export logic
        const exportData = {
        metadata: {
          generatedAt: new Date().toISOString(),
          totalProjects: projects.length,
          filters: {
            current: options.current || false,
            withAi: options.withAi || false
          }
        },
        projects: projects.map(project => {
          const projectData: any = {
            path: project.path,
            totalSize: project.totalSize,
            historyItemsCount: project.historyItems.length
          };
          
          if (options.withAi) {
            const conversationPairs = extractConversationPairs(project.path);
            const orderedPairs = historyOrder === 'reverse' 
              ? [...conversationPairs].reverse() 
              : conversationPairs;
            
            projectData.conversations = orderedPairs.map((pair, index) => ({
              index: index + 1,
              timestamp: pair.timestamp,
              userPrompt: pair.userPrompt.replace(/claude code/gi, 'cc').replace(/cc\([^)]*\)/gi, 'cc'),
              claudeResponse: pair.claudeResponse ? pair.claudeResponse.split('\n\n').map(part => {
                try {
                  return JSON.parse(part.trim());
                } catch {
                  return { type: 'raw', content: part.trim() };
                }
              }) : [{ type: 'no_response' }]
            }));
          } else {
            projectData.historyItems = project.historyItems.map((item, index) => ({
              index: index + 1,
              display: item.display,
              size: item.size
            }));
          }
          
          return projectData;
        })
      };
      
        try {
          fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf8');
          console.log(chalk.green(`✅ JSON data exported to: ${outputPath}`));
          console.log(chalk.blue(`📊 Exported ${exportData.projects.length} projects`));
          if (options.withAi) {
            const totalConversations = exportData.projects.reduce((sum, p) => sum + (p.conversations?.length || 0), 0);
            console.log(chalk.blue(`💬 Total conversations: ${totalConversations}`));
          }
          return;
        } catch (error) {
          console.error(chalk.red(`❌ Failed to write JSON file: ${error instanceof Error ? error.message : String(error)}`));
          process.exit(1);
        }
        
      } else if (outputFormat === 'markdown') {
        // Markdown export logic
        const timestamp = new Date().toISOString();
        let markdownContent = `# Claude Code Manager Export\n\n`;
        markdownContent += `**Generated**: ${timestamp}\n`;
        markdownContent += `**Total Projects**: ${projects.length}\n`;
        markdownContent += `**Filters**: ${options.current ? 'Current Project Only' : 'All Projects'}${options.withAi ? ', With AI Responses' : ''}\n\n`;
        
        projects.forEach((project, projectIndex) => {
          markdownContent += `---\n\n`;
          markdownContent += `## Project ${projectIndex + 1}: \`${project.path}\`\n\n`;
          markdownContent += `- **Total Size**: ${(project.totalSize / 1024).toFixed(2)} KB\n`;
          markdownContent += `- **History Entries**: ${project.historyItems.length}\n\n`;
          
          if (options.withAi) {
            // Display conversation pairs with Claude responses
            const conversationPairs = extractConversationPairs(project.path);
            const orderedPairs = historyOrder === 'reverse' 
              ? [...conversationPairs].reverse() 
              : conversationPairs;
            
            markdownContent += `### Conversations\n\n`;
            
            orderedPairs.forEach((pair, index) => {
              // Display user prompt (replace claude code references with cc)
              const processedUserPrompt = pair.userPrompt.replace(/claude code/gi, 'cc').replace(/cc\\([^)]*\\)/gi, 'cc');
              markdownContent += `## 💬 Conversation ${index + 1}\n\n`;
              markdownContent += `**You:** ${processedUserPrompt}\n\n`;
              
              // Display AI response if available
              if (pair.claudeResponse) {
                // Parse and display each JSONL-style response part with better formatting
                const responseParts = pair.claudeResponse.split('\\n\\n');
                let textResponses: string[] = [];
                let toolCalls: any[] = [];
                let thinkingParts: string[] = [];
                
                responseParts.forEach((part, partIndex) => {
                  if (part.trim()) {
                    try {
                      const jsonData = JSON.parse(part.trim());
                      
                      if (jsonData.type === 'text') {
                        textResponses.push(jsonData.content);
                      } else if (jsonData.type === 'tool_use') {
                        toolCalls.push(jsonData);
                      } else if (jsonData.type === 'thinking') {
                        thinkingParts.push(jsonData.content);
                      }
                    } catch (e) {
                      // Handle malformed JSON as raw text - might be truncated console output
                    }
                  }
                });
                
                // Display thinking first if any (as a collapsed section)
                if (thinkingParts.length > 0) {
                  markdownContent += `<details>\n<summary>🤔 AI's internal thoughts...</summary>\n\n`;
                  thinkingParts.forEach(thinking => {
                    markdownContent += `> ${thinking}\n\n`;
                  });
                  markdownContent += `</details>\n\n`;
                }
                
                // Display main AI response
                if (options.fullMessage) {
                  // In full-message mode, show all content including unparsed parts
                  markdownContent += `**AI Response (Full):**\n\n`;
                  
                  if (textResponses.length > 0) {
                    markdownContent += `**Text Responses:**\n`;
                    textResponses.forEach((text, idx) => {
                      markdownContent += `${idx + 1}. ${text}\n`;
                    });
                    markdownContent += `\n`;
                  }
                  
                  if (thinkingParts.length > 0) {
                    markdownContent += `**AI Thinking:**\n`;
                    thinkingParts.forEach((thinking, idx) => {
                      markdownContent += `${idx + 1}. ${thinking}\n`;
                    });
                    markdownContent += `\n`;
                  }
                  
                  // Show all response parts in full-message mode
                  markdownContent += `**All Response Parts:**\n\`\`\`json\n`;
                  responseParts.forEach((part, idx) => {
                    if (part.trim()) {
                      markdownContent += `${part.trim()}\n`;
                    }
                  });
                  markdownContent += `\`\`\`\n\n`;
                } else {
                  // Normal mode - human-readable summary
                  markdownContent += `**AI:** `;
                  if (textResponses.length > 0) {
                    // Combine all text responses into a natural flow
                    const combinedResponse = textResponses.join(' ').trim();
                    markdownContent += `${combinedResponse}\n\n`;
                  } else {
                    markdownContent += `*Worked with tools to complete the task*\n\n`;
                  }
                }
                
                // Display tool actions in a human-readable way
                if (toolCalls.length > 0) {
                  markdownContent += `**Actions taken:**\n`;
                  
                  const toolSummary = toolCalls.reduce((acc: Record<string, number>, tool) => {
                    const toolName = tool.tool;
                    acc[toolName] = (acc[toolName] || 0) + 1;
                    return acc;
                  }, {});
                  
                  Object.entries(toolSummary).forEach(([toolName, count]) => {
                    const action = getToolActionDescription(toolName, count as number);
                    markdownContent += `- ${action}\n`;
                  });
                  markdownContent += `\n`;
                  
                  // Show specific tool details in collapsed section for those who want details
                  markdownContent += `<details>\n<summary>🔧 Technical details</summary>\n\n`;
                  toolCalls.forEach((tool, idx) => {
                    markdownContent += `${idx + 1}. **${tool.tool}**\n`;
                    if (tool.input) {
                      // Show only the most relevant parameters
                      const relevantParams = extractRelevantParams(tool.tool, tool.input);
                      if (relevantParams.length > 0) {
                        relevantParams.forEach(param => {
                          markdownContent += `   - ${param}\n`;
                        });
                      }
                    }
                    markdownContent += `\n`;
                  });
                  markdownContent += `</details>\n\n`;
                }
              } else {
                markdownContent += `**AI:** *No response recorded*\n\n`;
              }
              
              markdownContent += `---\n\n`;
            });
          } else {
            // Original history display logic
            markdownContent += `### History\n\n`;
            const orderedHistoryItems = historyOrder === 'reverse' 
              ? [...project.historyItems].reverse() 
              : project.historyItems;
            
            orderedHistoryItems.forEach((item, index) => {
              markdownContent += `${index + 1}. ${item.display}\n\n`;
            });
          }
        });
        
        markdownContent += `---\n\n*Exported by Claude Code Manager v${require('../../package.json').version}*\n`;
        
        try {
          fs.writeFileSync(outputPath, markdownContent, 'utf8');
          console.log(chalk.green(`✅ Markdown data exported to: ${outputPath}`));
          console.log(chalk.blue(`📊 Exported ${projects.length} projects`));
          if (options.withAi) {
            const totalConversations = projects.reduce((sum, project) => {
              const pairs = extractConversationPairs(project.path);
              return sum + pairs.length;
            }, 0);
            console.log(chalk.blue(`💬 Total conversations: ${totalConversations}`));
          }
          return;
        } catch (error) {
          console.error(chalk.red(`❌ Failed to write Markdown file: ${error instanceof Error ? error.message : String(error)}`));
          process.exit(1);
        }
      }
    }
    
    // Display results with clean professional styling
    projects.forEach((project, projectIndex) => {
      // Clean separator
      console.log('─'.repeat(width));
      
      // Project header with sequential numbering
      const projectNumber = lpad((projectIndex + 1).toString(), 2, '0');
      console.log(chalk.bold.cyan(`Project ${projectNumber}: ${project.path}`));
      
      // Size display with clean formatting
      const sizeKB = (project.totalSize / 1024).toFixed(2);
      const sizeMB = (project.totalSize / (1024 * 1024)).toFixed(2);
      const sizeDisplay = project.totalSize > 1024 * 1024 
        ? `${sizeMB} MB` 
        : project.totalSize > 1024 
          ? `${sizeKB} KB` 
          : `${project.totalSize} bytes`;
      
      // Simple progress indicator using dots
      const maxSize = Math.max(...projects.map(p => p.totalSize));
      const sizeRatio = project.totalSize / maxSize;
      const barLength = 20;
      const filledLength = Math.floor(barLength * sizeRatio);
      const sizeBar = '▓'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
      
      console.log(chalk.white(`  TOTAL SIZE: ${chalk.bold(sizeDisplay)}`));
      console.log(chalk.white(`  History Details (${chalk.bold(project.historyItems.length)} entries):`));
      console.log();

      if (options.withAi) {
        // Display conversation pairs with AI responses
        const conversationPairs = extractConversationPairs(project.path);
        const orderedPairs = historyOrder === 'reverse' 
          ? [...conversationPairs].reverse() 
          : conversationPairs;
        
        orderedPairs.forEach((pair, index) => {
          const lineNumber = lpad((index + 1).toString(), 2, '0');
          
          // Display user prompt (replace claude code references with cc)
          const processedUserPrompt = pair.userPrompt.replace(/claude code/gi, 'cc').replace(/cc\([^)]*\)/gi, 'cc');
          const userPrompt = options.fullMessage 
            ? processedUserPrompt.replace(/\n/g, ' ')
            : processedUserPrompt.replace(/\n/g, ' ').substring(0, width > 10 ? width - 10 : width);
          const userTruncated = !options.fullMessage && processedUserPrompt.replace(/\n/g, ' ').length > width - 10 ? chalk.dim('...') : '';
          
          console.log(chalk.blue(`  ${lineNumber}. 👤 User: ${userPrompt}${userTruncated}`));
          
          // Display Claude response in JSONL format if available
          if (pair.claudeResponse) {
            console.log(chalk.green(`      🤖 AI:`));
            
            // Parse and display each JSONL-style response part
            const responseParts = pair.claudeResponse.split('\n\n');
            responseParts.forEach((part, partIndex) => {
              if (part.trim()) {
                let displayContent = part.trim();
                
                // Apply width truncation if not full message
                if (!options.fullMessage && displayContent.length > width - 12) {
                  displayContent = displayContent.substring(0, width - 15) + chalk.dim('...');
                }
                
                console.log(chalk.gray(`        ${displayContent}`));
              }
            });
          } else {
            console.log(chalk.gray(`      🤖 AI: ${JSON.stringify({ type: 'no_response' })}`));
          }
          
          console.log(); // Add spacing between conversation pairs
        });
      } else {
        // Original history display logic
        const orderedHistoryItems = historyOrder === 'reverse' 
          ? [...project.historyItems].reverse() 
          : project.historyItems;
        
        orderedHistoryItems.forEach((item, index) => {
          const lineNumber = lpad((index + 1).toString(), 2, '0');
          
          if (options.fullMessage) {
            // Show full message without truncation
            const content = item.display.replace(/\n/g, ' ');
            console.log(`  ${lineNumber}. ${content}`);
          } else {
            // Show truncated message (existing behavior)
            const content = item.display
              .replace(/\n/g, ' ')
              .substring(0, width > 6 ? width - 6 : width);
            const truncated = item.display.replace(/\n/g, ' ').length > width - 6 ? chalk.dim('...') : '';
            
            console.log(`  ${lineNumber}. ${content}${truncated}`);
          }
        });
      }
      
      console.log();
    });
    
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
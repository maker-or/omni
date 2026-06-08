# Master Pi-Agent Integration & Queue Plan for pipper (Pipper)

This plan details how we will integrate the `pi-agent` RPC process into pipper, focusing on message sending, the agentic steering queue, slash commands autocomplete, parsing/rendering streamed JSON events, and constructing message blocks from thread JSONL logs. 

---

## Design System & Component Constraints

> [!IMPORTANT]
> **Strict Reusability Rule:** All visual elements, dialogs, widgets, lists, dropdowns, and buttons must be built using the **existing UI components** already present in the codebase (e.g. `<Button>`, `<Dropdown>`, `<MenuItem>`, `<Tabs>`, `<TabItem>`, `<TabPanel>`, `<Select>`, `<Tooltip>`, `<Accordion>`, `<FileThumbnail>`, `<ThinkingSteps>`, `<ThinkingIndicator>`).
> 
> **No Custom Creation:** Do not build custom button styles, dropdowns, select wrappers, or scroll containers.
> 
> **Design Tokens Compliance:** Follow the design tokens defined in `src/index.css` (surface classes `surfaceClasses(N, N)`, fontWeights, springs, color variables).

---

## Proposed Architecture

```mermaid
graph TD
    subgraph Electron Main Process
        Main[Main Process Controller]
        Main -->|Spawns| RPC[pi --mode rpc]
    end
    
    subgraph React Renderer UI
        AppUI[Main Chat View]
        QueueUI[Sonner-Style Stacked Queue]
        Composer[Composer / Input Box]
        CommandPopover[Slash Commands Dropdown]
        DialogModal[AskUserQuestions Dialog Modal]
        StatsFooter[Session Token/Cost Footer]
    end
    
    Composer -->|Type '/'| CommandPopover
    Composer -->|If Status == streaming| QueueUI
    Composer -->|If Status == idle| Main -->|Send Prompt| RPC
    QueueUI -->|Steer / Follow-Up| Main -->|steer / follow_up RPC commands| RPC
    
    RPC -.->|get_commands| Main -.->|Send commands| Composer
    RPC -.->|extension_ui_request| Main -.->|Trigger Dialog| DialogModal
    DialogModal -.->|extension_ui_response| Main -.->|stdin write| RPC
    RPC -.->|get_session_stats| Main -.->|Sync stats| StatsFooter
```

---

## 1. Input Composer Capabilities (Queue & History)

We will modify `@/components/ui/input-message.tsx` to support history recall and inline queue management out of the box.

### History Recall (ArrowUp / ArrowDown)
* **API Props:**
  * `history?: string[]` (List of sent prompts, oldest first).
* **Behavior:**
  * When the textarea is focused and the cursor is at the first line (character offset `0`), pressing `ArrowUp` recalls the previous prompt in the history list.
  * Pressing `ArrowDown` at the last line (character offset at length) walks forward toward the in-progress draft.
  * We cache the user's active draft so it can be restored if they scroll back down.
  * Any edit (typing/pasting) or sending action exits history mode.

### Inline Message Queueing
* **API Props:**
  * `status?: "idle" | "streaming"` (Controlled status of the active session).
  * `queue?: QueuedMessage[]` (Controlled list of pending prompts: `{ id, text, files }`).
  * `onQueueChange?: (queue: QueuedMessage[]) => void` (Triggered on edit, remove, reorder, or enqueue).
  * `showQueue?: boolean` (Toggle display of the built-in queue cards above the input field, default `true`).
* **Behavior:**
  * If `status === "streaming"`, clicking Send or pressing `Enter` intercepts the prompt, packages it as a `QueuedMessage`, and appends it via `onQueueChange` instead of triggering `onSend`.
  * If `status === "idle"`, prompt is sent immediately via `onSend`.
  * If `showQueue` is true, the queue is rendered above the input area:
    * **Drag or Alt+Up/Down:** Shifts prompt index order.
    * **Double-click, Enter, or F2:** Removes the card from the queue and loads its text back into the composer textarea for editing.
    * **Close (✕) or Delete:** Discards the card from the queue.

---

## 2. Slash Commands Autocomplete

We will support command auto-completion directly inside the input message composer when the user types a leading slash (`/`).

### Command Discovery
* The Electron main process queries available commands from the `pi-agent` RPC process using:
  ```json
  {"type": "get_commands"}
  ```
* This returns commands registered in extensions, prompt templates (`.md` files), and skills:
  * `name`: Command name (e.g. `fix-tests` or `skill:brave-search`).
  * `description`: Explanatory text.
  * `source`: `"extension" | "prompt" | "skill"`.
  * `location` (optional): `"user" | "project" | "path"`.
* These commands are cached in Electron and shared with the React frontend through a renderer API: `window.pipper.pi.getCommands()`.

### Autocomplete Popover UI
* **Trigger:** Typing `/` as the first character in the `InputMessage` composer.
* **Filtering:** As the user types after the slash (e.g. `/fi`), the dropdown filters the list to matches (e.g. `/fix-tests`).
* **Visual Styling:**
  * Rendered as a floating popover positioned absolutely above the input textarea.
  * Curated lists separating commands by source (`Skills`, `Prompt Templates`, `Extensions`).
  * Displays the command name on the left, and source/description on the right.
* **Keyboard Navigation:**
  * `ArrowUp` / `ArrowDown`: Move the active selection index in the list.
  * `Enter` / `Tab`: Auto-complete the input with the selected slash command (e.g., replaces `/fi` with `/fix-tests `) and returns focus to the textarea.
  * `Escape` or clicking outside: Closes the autocomplete dropdown.

---

## 3. Session JSONL Log Parsing & Rendering

Thread logs read from `~/.pi/agent/sessions/--<path>--/*.jsonl` contain specific message objects. All entries except the header have an `id`, `parentId`, and `timestamp` (tree structure). To correctly reconstruct the active thread path, the application must trace backwards from the current leaf (the last node in the active branch) to the root (the entry with `parentId: null`).

### Compaction Traversal & Rendering
* **Algorithm:** When reading the path from leaf to root, if a `compaction` entry is encountered:
  * Extract the compaction `summary` and `firstKeptEntryId`.
  * Display a dedicated **Compaction Summary Card** in the UI.
  * Truncate/hide all conversation messages that occurred before `firstKeptEntryId` on that path (optionally keeping them accessible inside a collapsed "Show compacted history" accordion).
  * Render only the messages starting from `firstKeptEntryId` onwards.
* **Events:** Sync this state when a `compaction_start` or `compaction_end` event is received in the stream.

### UserMessage
* **Schema:** `{"role": "user", "content": "...", "timestamp": ..., "attachments": []}`
* **Rendering:** Displayed as a user chat message bubble aligned to the right. Attachments (base64 encoded images or files) are listed under the text prompt as small hover-expandable `<FileThumbnail>` nodes.

### AssistantMessage
* **Schema:**
  ```json
  {
    "role": "assistant",
    "content": [
      { "type": "text", "text": "Hello!" },
      { "type": "thinking", "thinking": "Deciding step..." },
      { "type": "toolCall", "id": "call_123", "name": "bash", "arguments": { "command": "ls" } }
    ],
    "model": "claude-sonnet-4-20250514",
    "timestamp": 1733234567890
  }
  ```
* **Rendering:** Iterated block-by-block inside a left-aligned assistant chat container:
  * `type: "text"`: Rendered as formatted markdown text via `Streamdown`.
  * `type: "thinking"`: Rendered inside a collapsible `<ThinkingSteps>` block.
  * `type: "toolCall"`: Rendered as an item in the active `<ThinkingSteps>` trace.

### ToolResultMessage
* **Schema:**
  ```json
  {
    "role": "toolResult",
    "toolCallId": "call_123",
    "toolName": "bash",
    "content": [{ "type": "text", "text": "output..." }],
    "isError": false
  }
  ```
* **Rendering:** Correlated to the original `toolCall` block using the `toolCallId` and rendered inside the corresponding `<ThinkingStep>` node:
  * Transitions the active step's status badge to `"complete"` or `"error"` (if `isError` is true, highlighted in red).
  * If it contains terminal console output (e.g. `toolName === "bash"`), it is rendered as an embedded terminal logs console box inside the step.

### BashExecutionMessage
* **Schema:**
  ```json
  {
    "role": "bashExecution",
    "command": "ls -la",
    "output": "total 48...",
    "exitCode": 0,
    "cancelled": false
  }
  ```
* **Rendering:** Rendered inline as a `<ThinkingStep>` node inside the `<ThinkingSteps>` trace deck:
  * **Header:** Displays `icon="terminal"`, the command string as the label (truncated if long, with full text available on hover), and status text reflecting the outcome (e.g., `completed`, `exit code <N>`, or `cancelled`).
  * **Content:** An embedded terminal-styled console container showing the accumulated stdout/stderr output.
  * **Status:** Maps to complete, error (if exitCode !== 0), or warning/pending.

### Custom & Extension Message Entries (`custom_message` / `custom`)
* **`custom_message` Entry:** Represents extension-injected content that participates in LLM context.
  * **Rendering:** If `display === true`, render inline in the chat flow with a distinct border style indicating it came from an extension.
* **`custom` Entry:** Represents extension state persistence. It is ignored during rendering and context building.

### Label Entries (Bookmarks / Checkpoints)
* **Schema:** `{"type": "label", "targetId": "msg_id", "label": "checkpoint-1"}`
* **Rendering:** Display a small bookmark badge next to the message corresponding to `targetId` showing the `label` text. If `label` is cleared/undefined, remove the badge.

### Branch Summary Entries (`branch_summary`)
* **Schema:** `{"type": "branch_summary", "fromId": "common_ancestor_id", "summary": "..."}`
* **Rendering:** Rendered as a system information block indicating that the user switched branches, presenting the LLM-generated summary of what was completed/explored on the abandoned path.

---

## 4. SQLite DB vs. JSONL Disk Files Synchronization

We use a hybrid storage approach to maintain synchronization with both our application's UI structure and the global CLI:

### What We Store in SQLite Database
We only store configuration and relation metadata inside our local `sqlite` database:
1. **Projects Table:** `id`, `name`, `path`, `icon`. (Where `path` is the absolute workspace directory).
2. **Threads Table:** `id`, `project_id`, `title`, `session_file_name`. (Where `session_file_name` refers to the target timestamped `.jsonl` session file).
3. **Messages Table:** Left **unused** or treated strictly as a read-only local cache. Conversation messages themselves are **never** synced back to SQLite to prevent conflicts.

### Reading Session Data From Disk & Display Name Extraction
* **Session Directory Discovery:**
  * When a project is active, we resolve its absolute directory path into the encoded format expected by the `pi` CLI (converting all slashes to hyphens and wrapping in double hyphens):
    * *Example:* `/Users/username/myproject` resolves to the folder `~/.pi/agent/sessions/--Users-username-myproject--/`
  * We read the files in this directory to list active threads (each `.jsonl` file name represents a thread's timestamp ID).
* **Title / Display Name Syncing:**
  * When constructing the thread list, scan the entries in each `.jsonl` file. The display name is resolved from the latest `session_info` entry's `name` field.
  * If no `session_info` entry is found, we fall back to a truncated version of the first `user` role message. If the thread is entirely empty, fall back to the timestamp name.
* **Conversation List Construction:**
  * When a thread is clicked, we read the target JSONL file from disk.
  * We build the active path from the leaf to the root, filtering out compacted messages, and parse/render the remaining entries dynamically in React.

### Thread Deletion
* When a user deletes a thread in the UI:
  * Delete the corresponding `.jsonl` file from the `~/.pi/agent/sessions/--<path>--/` directory (optionally utilizing the system trash via the `trash` module if available to allow recovery).
  * Remove the corresponding record from the SQLite `threads` table.

---

## 5. Subprocess Communication & Stream Reader

In the Electron main process, we spawn and manage communication with `pi --mode rpc`:

### Spawning
```typescript
import { spawn } from "child_process";
const agentProcess = spawn("pi", ["--mode", "rpc", "--session", sessionFilePath]);
```

### JSONL Stream Reader
We read the `stdout` stream line-by-line using a `StringDecoder` buffer handler to correctly splice line endings:
```typescript
import { StringDecoder } from "string_decoder";

function attachJsonlReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  stream.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      if (line.trim().length > 0) {
        onLine(line);
      }
    }
  });

  stream.on("end", () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      if (line.trim().length > 0) {
        onLine(line);
      }
    }
  });
}

attachJsonlReader(agentProcess.stdout, (line) => {
  try {
    const event = JSON.parse(line);
    // Send event through IPC to React Renderer
    mainWindow.webContents.send("pi:event", event);
  } catch (err) {
    console.error("Failed to parse event JSONL:", line, err);
  }
});
```

### Sending Input & Interrupt commands
* **Prompt:** Write JSON string followed by a newline:
  ```typescript
  agentProcess.stdin.write(JSON.stringify({ type: "prompt", message: promptText }) + "\n");
  ```
* **Abort:** If the user interrupts or stops streaming:
  ```typescript
  agentProcess.stdin.write(JSON.stringify({ type: "abort" }) + "\n");
  ```

---

## 6. Extension UI Protocol & Dialog Handling

Extensions running inside the agent can request interactive dialogs or issue fire-and-forget UI updates. These are received as `"extension_ui_request"` events on stdout.

### Interactive Dialogs (Requires Response)
When a dialog request is received, we map it directly to the existing `@/components/ui/ask-user-questions.tsx` (`<AskUserQuestions>`) component and render it as an overlay modal:

1. **`select`**
   * *Request:* `{"type": "extension_ui_request", "id": "uuid", "method": "select", "title": "Allow dangerous command?", "options": ["Allow", "Block"]}`
   * *Mapping:*
     ```typescript
     const question: AskUserQuestion = {
       id: id,
       title: title,
       options: options.map(opt => ({ id: opt, title: opt })),
       multiSelect: false,
       skippable: false,
     }
     ```
   * *Response:* `{"type": "extension_ui_response", "id": "uuid", "value": "Allow"}` (or `cancelled: true`)
2. **`confirm`**
   * *Request:* `{"type": "extension_ui_request", "id": "uuid", "method": "confirm", "title": "Clear session?", "message": "All messages will be lost."}`
   * *Mapping:*
     ```typescript
     const question: AskUserQuestion = {
       id: id,
       title: title + (message ? `\n\n${message}` : ""),
       options: [
         { id: "yes", title: "Yes" },
         { id: "no", title: "No" }
       ],
       multiSelect: false,
       skippable: false,
     }
     ```
   * *Response:* `{"type": "extension_ui_response", "id": "uuid", "confirmed": true}` (or `cancelled: true`)
3. **`input`**
   * *Request:* `{"type": "extension_ui_request", "id": "uuid", "method": "input", "title": "Enter a value", "placeholder": "..."}`
   * *Mapping:*
     ```typescript
     const question: AskUserQuestion = {
       id: id,
       title: title,
       options: [],
       allowOther: true,
       otherPlaceholder: placeholder || "Type your input...",
       skippable: false,
     }
     ```
   * *Response:* `{"type": "extension_ui_response", "id": "uuid", "value": "entered text"}` (or `cancelled: true`)
4. **`editor`**
   * *Request:* `{"type": "extension_ui_request", "id": "uuid", "method": "editor", "title": "Edit some text", "prefill": "..."}`
   * *Mapping:*
     ```typescript
     const question: AskUserQuestion = {
       id: id,
       title: title,
       options: [],
       allowOther: true,
       otherPlaceholder: "Type your multi-line edit...",
       skippable: false,
     }
     // Pass the 'prefill' text inside the defaultAnswers prop
     const defaultAnswers = {
       [id]: { questionId: id, selectedIds: [], otherText: prefill }
     }
     ```
   * *Response:* `{"type": "extension_ui_response", "id": "uuid", "value": "edited text"}` (or `cancelled: true`)

### Fire-and-Forget UI Updates (No Response Needed)
1. **`notify`**
   * *Payload:* `{"type": "extension_ui_request", "id": "uuid", "method": "notify", "message": "...", "notifyType": "warning"}`
   * *UI:* Display a Sonner notification toast corresponding to the `notifyType` (`info` = default, `warning` = orange, `error` = red).
2. **`setTitle`**
   * *Payload:* `{"type": "extension_ui_request", "id": "uuid", "method": "setTitle", "title": "..."}`
   * *UI:* Send an IPC event to update the title bar label to the requested title.
3. **`set_editor_text`**
   * *Payload:* `{"type": "extension_ui_request", "id": "uuid", "method": "set_editor_text", "text": "..."}`
   * *UI:* Replace the active text in the composer `<textarea>` with the prefilled text.

---

## 7. Error & Title Bar Handling

### Error Toast Notifications
* Whenever an RPC command response returns `success: false` (e.g. model switching failures or parse errors):
  ```json
  {"type": "response", "command": "set_model", "success": false, "error": "Model not found..."}
  ```
  We intercept this in Electron and dispatch it to the renderer as a red toast alert showing the parsed `error` string.

### Title Bar & Tab Navigation States
* **Dynamic Thread & Tab Title Updates:** The thread name within the tab view, sidebar navigation list, and main window title is dynamically updated using the active session/thread name. All hardcoded mock titles (such as "omni thread" or similar mock strings) are replaced.
* **Preserve Project Icons:** Project icons must be preserved exactly as configured in the SQLite database and should never be overwritten or changed during dynamic title updates.
* **Agent Start (`agent_start`):** Upon execution start, we change the window title bar in the React header (and/or the BrowserWindow frame title) to append a status badge: `"{project} (Running...)"`.
* **Agent End (`agent_end`):** Upon execution completion, we restore the title back to its resting state: `"{project}"`.
* **Dynamic Extension Override (`setTitle`):** If an extension triggers a `setTitle` request, the title (including tab/view titles) is updated to the explicit string requested by the extension.

---

## 8. Tool Renderers & Thinking State

We will strictly render active execution steps and thinking logs using the `<ThinkingSteps>` and `<ThinkingIndicator>` components:

### Active Loading State
* When the agent is in streaming/thinking mode, we will display the `<ThinkingIndicator>` inline as the active processing indicator.

### Reasoning and Execution Trace (`<ThinkingSteps>`)
We structure the events into accordion-collapsible trace decks using this exact layout style:
```tsx
<ThinkingSteps open={open} onOpenChange={setOpen}>
  <ThinkingStepsHeader>Research Agent</ThinkingStepsHeader>
  <ThinkingStepsContent>
    {/* Map of parsed tool execution steps */}
    <ThinkingStep 
      index={index} 
      icon={iconName} 
      label={stepLabel} 
      description={stepDescription} 
      status={status} // "active" | "complete" | "pending"
      isLast={isLast}
    >
      {/* If search step, display sources badges */}
      <ThinkingStepSources>
        <ThinkingStepSource>x.com</ThinkingStepSource>
        <ThinkingStepSource>github.com</ThinkingStepSource>
      </ThinkingStepSources>
      
      {/* If screenshot or layout output, display preview image */}
      <ThinkingStepImage src={imageSrc} caption={imageCaption} />
      
      {/* If multi-line files details, display nested details list */}
      <ThinkingStepDetails
        summary={detailsSummary}
        details={detailsLinesArray}
      />
    </ThinkingStep>
  </ThinkingStepsContent>
</ThinkingSteps>
```

### Event Type to Icon Mappings
* Web search: `icon="search"` or `icon="globe"`
* Code/file manipulations: `icon="dot"` or `icon="brain"`
* Final completions: `icon="check"`

---

## 9. Dynamic Model Config & Switching

* **Model Listing:** Query the running RPC process via `get_available_models` to populate the frontend selection dropdown.
* **Reasoning Config:** Switch model using `set_model` or adjust thinking depth using `set_thinking_level` or `cycle_thinking_level`.
* **Graceful Fallbacks:** If a model fails or becomes unavailable, catch the error, toast the user, and automatically invoke `cycle_model` to try the next available provider model.

---

## 10. RPC Event Reference & UI State Mapping

The `pi-agent` RPC streams events to stdout as JSON lines. We parse and map these events to the React state and component behaviors:

### Lifecycle & Session State Events
* **`agent_start`** `{"type": "agent_start"}`
  * *UI Action:* Transition UI status to `"streaming"`. Disable composer submit (divert inputs to the visual queue stack). Update window title bar.
* **`agent_end`** `{"type": "agent_end", "messages": [...]}`
  * *UI Action:* Transition UI status to `"idle"`. Read any generated messages. Automatically dispatch the next item in the visual queue (if any). Reset window title bar. Query session stats via `get_session_stats` to update the footer indicators.
* **`turn_start`** `{"type": "turn_start"}`
  * *UI Action:* Initialize list of thinking/tool cards for this specific turn.
* **`turn_end`** `{"type": "turn_end", "message": {...}, "toolResults": [...]}`
  * *UI Action:* Finalize display of assistant message and tool outputs for this turn. Query session stats via `get_session_stats`.
* **`message_start`** `{"type": "message_start", "message": {...}}`
  * *UI Action:* Append a new message block in the chat stream.
* **`message_end`** `{"type": "message_end", "message": {...}}`
  * *UI Action:* Finalize message text and freeze token accumulator.

### Streaming Delta Events
* **`message_update`** `{"type": "message_update", "message": {...}, "assistantMessageEvent": {...}}`
  * Check the nested `assistantMessageEvent.type`:
    * `start` / `text_start`: Initialize the text response container.
    * `text_delta`: Stream raw tokens to `<ChatMessage>` using `Streamdown`.
    * `text_end`: Finalize markdown layout rendering.
    * `thinking_start`: Create and open the collapsible thinking trace container.
    * `thinking_delta`: Stream reasoning tokens into the active `<ThinkingIndicator>` or thoughts box.
    * `thinking_end`: Close the thinking trace wrapper or set to completed state.
    * `toolcall_start` / `toolcall_delta` / `toolcall_end`: Show card showing pending tool arguments, moving to active execution card once `tool_execution_start` fires.

### Tool Execution Events
* **`tool_execution_start`**
  ```json
  {"type": "tool_execution_start", "toolCallId": "call_abc123", "toolName": "bash", "args": {"command": "ls"}}
  ```
  * *UI Action:* Instantiate a new step in `<ThinkingSteps>`. If `toolName === "bash"`, open the terminal log panel showing the run command.
* **`tool_execution_update`**
  ```json
  {"type": "tool_execution_update", "toolCallId": "call_abc123", "toolName": "bash", "partialResult": {"content": [{"type": "text", "text": "stdout..."}]}}
  ```
  * *UI Action:* Replace the contents of the step/terminal card with the accumulated `partialResult.content[0].text`.
* **`tool_execution_end`**
  ```json
  {"type": "tool_execution_end", "toolCallId": "call_abc123", "toolName": "bash", "result": {...}, "isError": false}
  ```
  * *UI Action:* Mark the execution card as completed (or red/error if `isError` is true).

### System & Control Events
* **`queue_update`** `{"type": "queue_update", "steering": [...], "followUp": [...]}`
  * *UI Action:* Sync the visual Sonner card queue stack with the exact array contents of `steering` and `followUp` lists.
* **`compaction_start`** `{"type": "compaction_start", "reason": "threshold"}`
  * *UI Action:* Display inline notification: *"Compacting thread context to fit context window..."*
* **`compaction_end`**
  ```json
  {"type": "compaction_end", "result": { "summary": "...", "firstKeptEntryId": "abc123" }, "aborted": false}
  ```
  * *UI Action:* Re-render message log from the specified `firstKeptEntryId` to clean up old compacted entries.
* **`auto_retry_start`**
  ```json
  {"type": "auto_retry_start", "attempt": 1, "maxAttempts": 3, "errorMessage": "Overloaded"}
  ```
  * *UI Action:* Show transient status toast: *"Provider overloaded. Retrying (Attempt 1/3)..."*
* **`auto_retry_end`** `{"type": "auto_retry_end", "success": true}`
  * *UI Action:* Dismiss the retry status toast.
* **`extension_error`** `{"type": "extension_error", "extensionPath": "...", "error": "..."}`
  * *UI Action:* Render extension error details inline as a warning banner.

---

## 11. Performance & Thread Optimization

* **Virtualization:** Use `@tanstack/react-virtual` to window large message logs and stdout streams.
* **Incremental Markdown:** Render text streams dynamically using `Streamdown`.
* **Subprocess Process Swapping (Project Level):** Maintain a cache of active project subprocesses. Instantly switch projects by swapping the active RPC process reference.
* **Session Thread Swapping (Thread Level):**
  * When swapping threads *within the same project*, instead of spawning a new child process, we query the active process with a `"switch_session"` payload:
    ```json
    { "type": "switch_session", "sessionPath": "/path/to/target/session.jsonl" }
    ```
  * This permits near-instant swapping. If blocked by an extension, display a caution toast notification.

---

## 12. Real-Time Status & Statistics Footer

We will implement a sleek, secondary footer bar at the bottom of the main chat view (matching the design system colors and typography) to display token usage and costs:

* **Trigger:** Fetched by calling `get_session_stats` at the end of each turn (`agent_end` or `turn_end`).
* **Visual Information:**
  * **Tokens Bar:** A progress indicator displaying context window usage percentage (e.g. `60k / 200k tokens (30%)`).
  * **Session Cost:** Displays current session cost (e.g. `$0.45`).
  * **Activity Indicators:** Messages and tool counts (e.g. `22 messages • 12 tools`).
* **Compaction state:** If compaction has just completed, hide or display "Compacting..." until fresh stats are provided.

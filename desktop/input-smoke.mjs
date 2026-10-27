// Only called from explicit smoke mode, using that mode's isolated data/profile.
export async function verifyAssistantDraft(window) {
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  async function waitFor(source) {
    const deadline = Date.now() + 10000;
    while (!await evaluate(source)) {
      if (Date.now() > deadline) throw new Error("Assistant draft regression: " + source);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  // A restarted profile restores the assistant's open state and hides its launcher.
  await waitFor("Boolean(document.querySelector('[aria-label=\"打开会务智能助手\"]') || document.querySelector('[aria-label=\"切换 AI 会话\"]'))");
  await evaluate("document.querySelector('[aria-label=\"打开会务智能助手\"]')?.click(); void 0");
  const request = "[...document.querySelectorAll('.action-assistant-suggestions button')].find(b => b.textContent === '帮我安排一场新会议')";
  await waitFor(`Boolean(${request})`);
  const firstId = await evaluate("document.querySelector('[aria-label=\"切换 AI 会话\"]').value");
  for (let turn = 0; turn < 2; turn++) {
    await evaluate(`(${request}).click()`);
    await waitFor("Boolean(document.querySelector('.assistant-meeting-options-table .meeting-attendee-editor'))");
    if (await evaluate("Boolean(document.querySelector('[aria-label=\"助手异常恢复\"]'))")) throw new Error("Assistant draft crashed");
  }
  const firstCount = await evaluate("document.querySelectorAll('.action-assistant-message-group').length");
  await evaluate("document.querySelector('[aria-label=\"新建会话\"]').click()");
  await waitFor(`Boolean(${request})`);
  await evaluate(`(${request}).click()`);
  await waitFor("Boolean(document.querySelector('.assistant-meeting-options-table .meeting-attendee-editor'))");
  const secondId = await evaluate("document.querySelector('[aria-label=\"切换 AI 会话\"]').value");
  const secondCount = await evaluate("document.querySelectorAll('.action-assistant-message-group').length");
  await waitFor("document.querySelector('.assistant-history-status')?.textContent.includes('已保存')");
  await window.loadURL(window.webContents.getURL());
  await waitFor("Boolean(document.querySelector('[aria-label=\"切换 AI 会话\"]'))");
  if (await evaluate("document.querySelector('[aria-label=\"切换 AI 会话\"]').value") !== secondId) throw new Error("Active conversation lost on refresh");
  if (await evaluate("document.querySelectorAll('.action-assistant-message-group').length") !== secondCount) throw new Error("Conversation messages lost on refresh");
  if (await evaluate("Boolean(document.querySelector('.assistant-meeting-options-table'))")) throw new Error("Unsaved assistant draft must not be restored");
  await evaluate(`(() => { const select = document.querySelector('[aria-label="切换 AI 会话"]'); select.value = ${JSON.stringify(firstId)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`document.querySelectorAll('.action-assistant-message-group').length === ${firstCount}`);
  return { turns: 2, standaloneAttendeeEditor: true, restoredConversations: true };
}

export async function verifyConfirmationInput(window, origin) {
  const contents = window.webContents;
  const evaluate = (source) => contents.executeJavaScript(source);
  async function waitFor(source) {
    const deadline = Date.now() + 15000;
    while (!await evaluate(source)) {
      if (Date.now() > deadline) throw new Error(`Input regression check timed out: ${source}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  await window.loadURL(`${origin}/admin?section=rooms`);
  await waitFor("Boolean(document.querySelector('.admin-room-card input'))");
  await evaluate("window.confirm = () => { throw new Error('Blocking confirmation must not be used'); }; void 0");
  contents.debugger.attach("1.3");
  async function typeInto(selector, text) {
    await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.scrollIntoView({ block: 'center' }); input.focus(); input.select(); })()`);
    for (const character of text) {
      await contents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "char", text: character });
    }
    const result = await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); return { value: input.value, focused: document.activeElement === input }; })()`);
    if (!result.focused || result.value !== text) throw new Error(`Input focus/value did not recover: ${selector}`);
  }
  const input = ".admin-room-card input:not([type=checkbox])";
  const textarea = ".admin-room-card textarea";
  const clickDelete = "document.querySelector('.admin-room-card .admin-delete-button').click()";
  const waitOpen = "Boolean(document.querySelector('.app-confirmation-dialog[open]'))";
  const waitClosed = "!document.querySelector('.app-confirmation-dialog[open]')";
  try {
    await typeInto(input, "焦点验证会议室");
    for (let pass = 0; pass < 3; pass++) {
      await evaluate(clickDelete);
      await waitFor(waitOpen);
      // Background input is inert; the safe cancel button receives initial keyboard focus.
      if (!await evaluate("document.activeElement === document.querySelector('.app-confirmation-dialog button')")) throw new Error("Confirmation must default to cancel");
      await evaluate("document.querySelector('.app-confirmation-dialog button').click()");
      await waitFor(waitClosed);
      if (await evaluate("document.querySelectorAll('.admin-room-card').length") !== 6) throw new Error("Canceled room deletion mutated the draft");
      await typeInto(input, `取消后输入${pass}`);
      await typeInto(textarea, `取消后多行输入${pass}`);
    }
    await evaluate(clickDelete);
    await waitFor(waitOpen);
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await waitFor(waitClosed);
    if (await evaluate("document.querySelectorAll('.admin-room-card').length") !== 6) throw new Error("Escape must cancel deletion");
    await typeInto(input, "Escape后输入正常");
    await evaluate(clickDelete);
    await waitFor(waitOpen);
    await evaluate("document.querySelector('.app-confirmation-dialog .is-danger').click()");
    await waitFor("document.querySelectorAll('.admin-room-card').length === 5");
    await waitFor(waitClosed);
    await typeInto(input, "确认后输入正常");
    await typeInto(textarea, "确认后多行输入正常");
    return { cancel: 3, escape: true, confirm: true, textInput: true, textarea: true };
  } finally {
    contents.debugger.detach();
    // No draft config is published; reset only this isolated renderer, never a user's workspace.
    await evaluate("window.onbeforeunload = null");
    // Destroying the smoke window after reporting avoids the unsaved-exit dialog entirely.
  }
}

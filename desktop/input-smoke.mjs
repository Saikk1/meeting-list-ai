// Only called from explicit smoke mode, using that mode's isolated data/profile.
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

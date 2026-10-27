export function focusMeetingIssue(form: HTMLFormElement | null, field: string) {
  if (!form) return;
  const name = field === "meetingRoom" ? "meetingRoomId" : field;
  const input = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "input, select",
    ),
  ).find((element) => element.name === name && !element.disabled);
  requestAnimationFrame(() => {
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

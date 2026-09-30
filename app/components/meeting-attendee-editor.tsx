"use client";

import { Plus, Trash2, UserRound } from "lucide-react";
import { useMemo } from "react";
import type { ContactRecord } from "../lib/contacts";
import type { MeetingAttendee } from "../lib/meeting-data";
import {
  buildUnitDirectory,
  resolveCanonicalUnit,
} from "../lib/unit-directory";
import { useAdminConfig } from "../lib/use-admin-config";
import { ContactAutocomplete } from "./contact-autocomplete";

function attendeeId() {
  return `attendee-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyMeetingAttendee(): MeetingAttendee {
  return {
    id: attendeeId(),
    name: "",
    unit: "",
    department: "",
    title: "",
    source: "手动录入",
  };
}

function identityPart(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function duplicateAttendeeIds(attendees: MeetingAttendee[]) {
  const byIdentity = new Map<string, string[]>();
  attendees.forEach((attendee) => {
    if (!attendee.name.trim()) return;
    const identity = `${identityPart(attendee.name)}\u0000${identityPart(attendee.unit)}`;
    byIdentity.set(identity, [...(byIdentity.get(identity) ?? []), attendee.id]);
  });
  return new Set(
    Array.from(byIdentity.values())
      .filter((ids) => ids.length > 1)
      .flat(),
  );
}

export function MeetingAttendeeEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: MeetingAttendee[];
  onChange: (value: MeetingAttendee[]) => void;
  disabled?: boolean;
}) {
  const { config } = useAdminConfig();
  const unitDirectory = useMemo(
    () => buildUnitDirectory(config.rosterRules.aliases),
    [config.rosterRules.aliases],
  );
  const duplicateIds = useMemo(() => duplicateAttendeeIds(value), [value]);

  function patchAttendee(
    id: string,
    patch: Partial<Omit<MeetingAttendee, "id">>,
  ) {
    onChange(
      value.map((attendee) =>
        attendee.id === id ? { ...attendee, ...patch } : attendee,
      ),
    );
  }

  function applyContact(id: string, contact: ContactRecord) {
    const canonicalUnit =
      resolveCanonicalUnit(contact.unit, unitDirectory)?.canonical ??
      contact.unit;
    patchAttendee(id, {
      name: contact.name,
      unit: canonicalUnit,
      department: contact.department,
      title: contact.title,
      source: "人员通讯录",
    });
  }

  function addAttendee() {
    onChange([...value, emptyMeetingAttendee()]);
  }

  return (
    <div className="meeting-attendee-editor">
      <div className="meeting-attendee-editor__toolbar">
        <div>
          <strong>参会人员</strong>
          <span>姓名必填；可直接输入，也可搜索通讯录自动带入信息</span>
        </div>
        <button type="button" onClick={addAttendee} disabled={disabled}>
          <Plus aria-hidden="true" />
          添加一人
        </button>
      </div>

      {value.length ? (
        <div className="meeting-attendee-editor__table-wrap">
          <table className="meeting-attendee-editor__table">
            <thead>
              <tr>
                <th>姓名 *</th>
                <th>单位</th>
                <th>部门</th>
                <th>职务</th>
                <th>来源</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {value.map((attendee, index) => {
                const missingName =
                  !attendee.name.trim() &&
                  Boolean(
                    attendee.unit.trim() ||
                      attendee.department.trim() ||
                      attendee.title.trim(),
                  );
                const duplicate = duplicateIds.has(attendee.id);
                return (
                  <tr
                    key={attendee.id}
                    className={missingName || duplicate ? "has-error" : ""}
                  >
                    <td>
                      <ContactAutocomplete
                        ariaLabel={`第 ${index + 1} 位参会人姓名`}
                        placeholder="输入姓名或搜索通讯录"
                        value={attendee.name}
                        onChange={(name) =>
                          patchAttendee(attendee.id, {
                            name,
                            source:
                              attendee.source === "人员通讯录"
                                ? "手动调整"
                                : attendee.source,
                          })
                        }
                        onSelect={(contact) =>
                          applyContact(attendee.id, contact)
                        }
                      />
                      {missingName ? <small>请填写姓名</small> : null}
                      {duplicate ? <small>与已有人员重复</small> : null}
                    </td>
                    <td>
                      <input
                        value={attendee.unit}
                        disabled={disabled}
                        placeholder="可留空"
                        aria-label={`第 ${index + 1} 位参会人单位`}
                        onChange={(event) =>
                          patchAttendee(attendee.id, {
                            unit: event.target.value,
                            source:
                              attendee.source === "人员通讯录"
                                ? "手动调整"
                                : attendee.source,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={attendee.department}
                        disabled={disabled}
                        placeholder="可留空"
                        aria-label={`第 ${index + 1} 位参会人部门`}
                        onChange={(event) =>
                          patchAttendee(attendee.id, {
                            department: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={attendee.title}
                        disabled={disabled}
                        placeholder="可留空"
                        aria-label={`第 ${index + 1} 位参会人职务`}
                        onChange={(event) =>
                          patchAttendee(attendee.id, {
                            title: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <span className="meeting-attendee-editor__source">
                        {attendee.source || "手动录入"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="meeting-attendee-editor__remove"
                        aria-label={`移除 ${attendee.name || `第 ${index + 1} 行`}`}
                        disabled={disabled}
                        onClick={() =>
                          onChange(
                            value.filter((item) => item.id !== attendee.id),
                          )
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <button
          type="button"
          className="meeting-attendee-editor__empty"
          onClick={addAttendee}
          disabled={disabled}
        >
          <UserRound aria-hidden="true" />
          <span>
            <strong>暂未录入具体人员</strong>
            <small>可以只保留预计人数，也可以在这里手动添加</small>
          </span>
          <Plus aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

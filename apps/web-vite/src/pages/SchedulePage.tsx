import { useEffect, useMemo, useState } from "react";
import {
  createWorkingHoursEntry,
  deleteWorkingHoursEntry,
  listAdminMasters,
  listScheduleExceptions,
  listWorkingHours,
  updateWorkingHoursEntry
} from "../shared/api/adminApi";
import { formatApiError } from "../shared/api/formatApiError";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { useI18n } from "../shared/i18n/I18nProvider";
import { useScopeContext } from "../shared/hooks/useScopeContext";
import { formatUiDate } from "../shared/i18n/dateTime";

type Master = {
  id: string;
  displayName: string;
  isActive: boolean;
};

type WorkingHour = {
  id: string;
  masterId: string | null;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
};

type ExceptionRow = {
  id: string;
  masterId: string | null;
  date: string;
  isClosed: boolean;
  note: string | null;
};

type DayDraft = {
  dayOfWeek: number;
  enabled: boolean;
  startTime: string;
  endTime: string;
  primaryEntryId: string | null;
  extraEntryIds: string[];
};

function minutesToTime(value: number) {
  const hh = Math.floor(value / 60)
    .toString()
    .padStart(2, "0");
  const mm = (value % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function timeToMinutes(value: string) {
  const parts = value.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) {
    return null;
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  return hh * 60 + mm;
}

function makeDefaultDayDraft(dayOfWeek: number): DayDraft {
  return {
    dayOfWeek,
    enabled: false,
    startTime: "09:00",
    endTime: "18:00",
    primaryEntryId: null,
    extraEntryIds: []
  };
}

const WEEKDAY_RENDER_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

function createDraftsByMaster(masters: Master[], hours: WorkingHour[]) {
  const map: Record<string, DayDraft[]> = {};

  for (const master of masters) {
    map[master.id] = Array.from({ length: 7 }).map((_, dayOfWeek) => makeDefaultDayDraft(dayOfWeek));
  }

  for (const master of masters) {
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      const masterDrafts = map[master.id];
      if (!masterDrafts) {
        continue;
      }
      const dayHours = hours
        .filter((item) => item.masterId === master.id && item.dayOfWeek === dayOfWeek)
        .sort((a, b) => a.startMinute - b.startMinute);

      if (dayHours.length === 0) {
        continue;
      }

      const first = dayHours[0];
      if (!first) {
        continue;
      }
      masterDrafts[dayOfWeek] = {
        dayOfWeek,
        enabled: dayHours.some((item) => item.isActive),
        startTime: minutesToTime(first.startMinute),
        endTime: minutesToTime(first.endMinute),
        primaryEntryId: first.id,
        extraEntryIds: dayHours.slice(1).map((item) => item.id)
      };
    }
  }

  return map;
}

export function SchedulePage() {
  const { t } = useI18n();
  const { tenantTimezone } = useScopeContext();
  const [masters, setMasters] = useState<{ pending: boolean; error: string | null; data: Master[] }>({
    pending: true,
    error: null,
    data: []
  });
  const [hours, setHours] = useState<{ pending: boolean; error: string | null; data: WorkingHour[] }>({
    pending: true,
    error: null,
    data: []
  });
  const [exceptions, setExceptions] = useState<{ pending: boolean; error: string | null; data: ExceptionRow[] }>({
    pending: true,
    error: null,
    data: []
  });
  const [baselineDraftsByMaster, setBaselineDraftsByMaster] = useState<Record<string, DayDraft[]>>({});
  const [draftsByMaster, setDraftsByMaster] = useState<Record<string, DayDraft[]>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingMasterId, setSavingMasterId] = useState<string | null>(null);

  async function loadData() {
    setActionError(null);
    setMasters((prev) => ({ ...prev, pending: true, error: null }));
    setHours((prev) => ({ ...prev, pending: true, error: null }));
    setExceptions((prev) => ({ ...prev, pending: true, error: null }));

    const [mastersResult, hoursResult, exceptionsResult] = await Promise.allSettled([
      listAdminMasters(),
      listWorkingHours(),
      listScheduleExceptions()
    ]);

    let nextMasters: Master[] = [];
    let nextHours: WorkingHour[] = [];

    if (mastersResult.status === "fulfilled") {
      nextMasters = mastersResult.value;
      setMasters({ pending: false, error: null, data: nextMasters });
    } else {
      setMasters({ pending: false, error: t("admin.schedule.loadMastersFailed"), data: [] });
    }

    if (hoursResult.status === "fulfilled") {
      nextHours = hoursResult.value;
      setHours({ pending: false, error: null, data: nextHours });
    } else {
      setHours({ pending: false, error: formatApiError(hoursResult.reason, t("admin.schedule.loadHoursFailed")), data: [] });
    }

    if (exceptionsResult.status === "fulfilled") {
      setExceptions({
        pending: false,
        error: null,
        data: exceptionsResult.value.map((item) => ({
          id: item.id,
          masterId: item.masterId,
          date: item.date,
          isClosed: item.isClosed,
          note: item.note
        }))
      });
    } else {
      setExceptions({
        pending: false,
        error: formatApiError(exceptionsResult.reason, t("admin.schedule.loadExceptionsFailed")),
        data: []
      });
    }

    if (nextMasters.length > 0) {
      const drafts = createDraftsByMaster(nextMasters, nextHours);
      setDraftsByMaster(drafts);
      setBaselineDraftsByMaster(drafts);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const masterNameById = useMemo(() => {
    return Object.fromEntries(masters.data.map((item) => [item.id, item.displayName]));
  }, [masters.data]);

  function draftFor(masterId: string, dayOfWeek: number) {
    return draftsByMaster[masterId]?.[dayOfWeek] ?? makeDefaultDayDraft(dayOfWeek);
  }

  function updateDraft(masterId: string, dayOfWeek: number, next: Partial<DayDraft>) {
    setDraftsByMaster((prev) => {
      const current = prev[masterId] ?? Array.from({ length: 7 }).map((_, index) => makeDefaultDayDraft(index));
      const updated = [...current];
      const currentDayDraft = updated[dayOfWeek] ?? makeDefaultDayDraft(dayOfWeek);
      updated[dayOfWeek] = {
        ...currentDayDraft,
        ...next
      };
      return {
        ...prev,
        [masterId]: updated
      };
    });
  }

  function normalizeDraftForCompare(input: DayDraft) {
    return {
      dayOfWeek: input.dayOfWeek,
      enabled: input.enabled,
      startTime: input.startTime,
      endTime: input.endTime
    };
  }

  function hasMasterUnsavedChanges(masterId: string) {
    const baseline = baselineDraftsByMaster[masterId] ?? Array.from({ length: 7 }).map((_, day) => makeDefaultDayDraft(day));
    const current = draftsByMaster[masterId] ?? Array.from({ length: 7 }).map((_, day) => makeDefaultDayDraft(day));
    if (baseline.length !== current.length) {
      return true;
    }
    for (let i = 0; i < current.length; i += 1) {
      const a = normalizeDraftForCompare(baseline[i] ?? makeDefaultDayDraft(i));
      const b = normalizeDraftForCompare(current[i] ?? makeDefaultDayDraft(i));
      if (
        a.dayOfWeek !== b.dayOfWeek ||
        a.enabled !== b.enabled ||
        a.startTime !== b.startTime ||
        a.endTime !== b.endTime
      ) {
        return true;
      }
    }
    return false;
  }

  async function handleSaveMaster(masterId: string) {
    const dayDrafts = draftsByMaster[masterId] ?? [];
    if (dayDrafts.length !== 7) {
      setActionError(t("admin.schedule.saveHoursFailed"));
      return;
    }

    setSavingMasterId(masterId);
    setActionError(null);

    try {
      for (const draft of dayDrafts) {
        if (!draft.enabled) {
          if (draft.primaryEntryId) {
            await deleteWorkingHoursEntry(draft.primaryEntryId);
          }
          for (const id of draft.extraEntryIds) {
            await deleteWorkingHoursEntry(id);
          }
          continue;
        }

        const startMinute = timeToMinutes(draft.startTime);
        const endMinute = timeToMinutes(draft.endTime);
        if (startMinute === null || endMinute === null || startMinute >= endMinute) {
          throw new Error(t("admin.schedule.invalidRange"));
        }

        if (draft.primaryEntryId) {
          await updateWorkingHoursEntry({
            id: draft.primaryEntryId,
            masterId,
            dayOfWeek: draft.dayOfWeek,
            startMinute,
            endMinute,
            isActive: true
          });
        } else {
          await createWorkingHoursEntry({
            masterId,
            dayOfWeek: draft.dayOfWeek,
            startMinute,
            endMinute,
            isActive: true
          });
        }

        for (const id of draft.extraEntryIds) {
          await deleteWorkingHoursEntry(id);
        }
      }

      await loadData();
    } catch (error) {
      if (error instanceof Error && error.message === t("admin.schedule.invalidRange")) {
        setActionError(error.message);
      } else {
        setActionError(formatApiError(error, t("admin.schedule.saveHoursFailed")));
      }
    } finally {
      setSavingMasterId(null);
    }
  }

  const pending = masters.pending || hours.pending || exceptions.pending;

  return (
    <section className="page-shell">
      <h1>{t("admin.schedule.title")}</h1>
      {pending ? <LoadingState text={t("admin.schedule.loadingHours")} /> : null}
      {masters.error ? <ErrorState text={masters.error} /> : null}
      {hours.error ? <ErrorState text={hours.error} /> : null}
      {exceptions.error ? <ErrorState text={exceptions.error} /> : null}
      {actionError ? <ErrorState text={actionError} /> : null}

      {!pending && !masters.error && masters.data.length === 0 ? (
        <EmptyState title={t("admin.schedule.emptyHoursTitle")} description={t("admin.schedule.emptyHoursDescription")} />
      ) : null}

      {masters.data.map((master) => (
        <article className="settings-card" key={master.id}>
          {hasMasterUnsavedChanges(master.id) ? (
            <p className="status-muted">{t("admin.schedule.unsavedStatus")}</p>
          ) : (
            <p className="status-success">{t("admin.schedule.savedStatus")}</p>
          )}
          <h2>
            {master.displayName} · {master.isActive ? t("common.status.active") : t("common.status.inactive")}
          </h2>

          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("common.col.day")}</th>
                  <th>{t("common.col.status")}</th>
                  <th>{t("admin.schedule.startTime")}</th>
                  <th>{t("admin.schedule.endTime")}</th>
                </tr>
              </thead>
              <tbody>
                {WEEKDAY_RENDER_ORDER.map((dayOfWeek) => {
                  const draft = draftFor(master.id, dayOfWeek);
                  return (
                    <tr key={`${master.id}:${dayOfWeek}`}>
                      <td>{t(`common.weekday.${dayOfWeek}`)}</td>
                      <td>
                        <label>
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(event) => updateDraft(master.id, dayOfWeek, { enabled: event.target.checked })}
                          />{" "}
                          {draft.enabled ? t("common.status.active") : t("common.status.inactive")}
                        </label>
                      </td>
                      <td>
                        <input
                          type="time"
                          value={draft.startTime}
                          disabled={!draft.enabled}
                          onChange={(event) => updateDraft(master.id, dayOfWeek, { startTime: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          value={draft.endTime}
                          disabled={!draft.enabled}
                          onChange={(event) => updateDraft(master.id, dayOfWeek, { endTime: event.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="inline-actions">
            <button
              className="btn btn-primary"
              type="button"
              disabled={savingMasterId === master.id || !hasMasterUnsavedChanges(master.id)}
              onClick={() => handleSaveMaster(master.id)}
            >
              {savingMasterId === master.id ? t("auth.loading") : t("admin.schedule.saveForMaster")}
            </button>
          </div>
        </article>
      ))}

      <h2>{t("admin.schedule.exceptionsTitle")}</h2>
      {exceptions.data.length > 0 ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.col.date")}</th>
                <th>{t("common.col.master")}</th>
                <th>{t("common.col.status")}</th>
                <th>{t("common.col.note")}</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.data.map((item) => (
                <tr key={item.id}>
                  <td>{formatUiDate(item.date, tenantTimezone)}</td>
                  <td>{item.masterId ? (masterNameById[item.masterId] ?? item.masterId) : t("common.value.all")}</td>
                  <td>{item.isClosed ? t("admin.schedule.closed") : t("admin.schedule.open")}</td>
                  <td>{item.note ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !pending && <EmptyState title={t("admin.schedule.emptyExceptionsTitle")} description={t("admin.schedule.emptyExceptionsDescription")} />
      )}
    </section>
  );
}

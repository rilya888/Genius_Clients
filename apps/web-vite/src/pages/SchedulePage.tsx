import { useEffect, useState } from "react";
import { listScheduleExceptions, listWorkingHours } from "../shared/api/adminApi";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { useI18n } from "../shared/i18n/I18nProvider";

type WorkingHour = {
  id: string;
  masterId: string | null;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
};

type ExceptionItem = {
  id: string;
  masterId: string | null;
  date: string;
  isClosed: boolean;
  note: string | null;
};

function formatMinute(minute: number) {
  const hh = Math.floor(minute / 60)
    .toString()
    .padStart(2, "0");
  const mm = (minute % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export function SchedulePage() {
  const { locale, t } = useI18n();
  const [hours, setHours] = useState<{ pending: boolean; error: string | null; data: WorkingHour[] }>({
    pending: true,
    error: null,
    data: []
  });
  const [exceptions, setExceptions] = useState<{
    pending: boolean;
    error: string | null;
    data: ExceptionItem[];
  }>({ pending: true, error: null, data: [] });

  useEffect(() => {
    let cancelled = false;

    listWorkingHours()
      .then((items) => {
        if (!cancelled) {
          setHours({ pending: false, error: null, data: items });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHours({ pending: false, error: t("admin.schedule.loadHoursFailed"), data: [] });
        }
      });

    listScheduleExceptions()
      .then((items) => {
        if (!cancelled) {
          setExceptions({
            pending: false,
            error: null,
            data: items.map((item) => ({
              id: item.id,
              masterId: item.masterId,
              date: item.date,
              isClosed: item.isClosed,
              note: item.note
            }))
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExceptions({ pending: false, error: t("admin.schedule.loadExceptionsFailed"), data: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function weekdayLabel(dayOfWeek: number) {
    return t(`common.weekday.${dayOfWeek}`);
  }

  return (
    <section className="page-shell">
      <h1>{t("admin.schedule.title")}</h1>

      {hours.pending ? <LoadingState text={t("admin.schedule.loadingHours")} /> : null}
      {hours.error ? <ErrorState text={hours.error} /> : null}

      {hours.data.length > 0 ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.col.master")}</th>
                <th>{t("common.col.day")}</th>
                <th>{t("common.col.range")}</th>
                <th>{t("common.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {hours.data.map((item) => (
                <tr key={item.id}>
                  <td>{item.masterId ?? t("common.value.all")}</td>
                  <td>{weekdayLabel(item.dayOfWeek)}</td>
                  <td>
                    {formatMinute(item.startMinute)} - {formatMinute(item.endMinute)}
                  </td>
                  <td>{item.isActive ? t("common.status.active") : t("common.status.inactive")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {hours.data.length === 0 && !hours.pending && !hours.error ? (
        <EmptyState title={t("admin.schedule.emptyHoursTitle")} description={t("admin.schedule.emptyHoursDescription")} />
      ) : null}

      <h2>{t("admin.schedule.exceptionsTitle")}</h2>
      {exceptions.pending ? <LoadingState text={t("admin.schedule.loadingExceptions")} /> : null}
      {exceptions.error ? <ErrorState text={exceptions.error} /> : null}

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
                  <td>{new Date(item.date).toLocaleDateString(locale)}</td>
                  <td>{item.masterId ?? t("common.value.all")}</td>
                  <td>{item.isClosed ? t("admin.schedule.closed") : t("admin.schedule.open")}</td>
                  <td>{item.note ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {exceptions.data.length === 0 && !exceptions.pending && !exceptions.error ? (
        <EmptyState title={t("admin.schedule.emptyExceptionsTitle")} description={t("admin.schedule.emptyExceptionsDescription")} />
      ) : null}
    </section>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listErrors, resolveError } from "@/lib/errors.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Check, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/errors")({
  component: ErrorsPage,
});

/** Human-readable Hebrew labels for known error types. */
const errorTypeLabels: Record<string, string> = {
  clarification_expired: "בירור פג תוקף",
  clarification_send_failed: "שליחת בירור נכשלה",
  missing_details: "חסרים פרטים",
  processing_failed: "כשל בעיבוד",
  sheet_write_failed: "כשל בכתיבה לגיליון",
  transcription_failed: "תמלול נכשל",
};

type ProcessingError = {
  id: string;
  error_type: string;
  error_description: string | null;
  created_at: string;
  resolved_at: string | null;
  incoming_messages: {
    sender_phone: string | null;
    raw_text: string | null;
    transcribed_text: string | null;
  } | null;
};

function ErrorsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listErrors);
  const resolveFn = useServerFn(resolveError);
  const { data, isLoading } = useQuery({
    queryKey: ["errors"],
    queryFn: () => listFn() as Promise<ProcessingError[]>,
  });
  const mut = useMutation({
    mutationFn: (id: string) => resolveFn({ data: { id } }),
    onSuccess: () => {
      toast.success("סומן כטופל");
      qc.invalidateQueries({ queryKey: ["errors"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCount = (data ?? []).filter((e) => !e.resolved_at).length;

  function StatusBadge({ resolved }: { resolved: boolean }) {
    if (resolved) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          <Check className="h-3.5 w-3.5" />
          טופל
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        פתוח
      </span>
    );
  }

  function typeLabel(t: string): string {
    return errorTypeLabels[t] ?? t;
  }

  return (
    <div className="space-y-6">
      {/* Header — red accent (this is the errors screen) */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500">
          <AlertTriangle className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-semibold leading-tight">שגיאות עיבוד</h2>
          <p className="text-sm text-muted-foreground leading-tight">
            {data ? (openCount > 0 ? `${openCount} שגיאות פתוחות` : "אין שגיאות פתוחות") : "טוען..."}
          </p>
        </div>
      </div>

      {/* Loading / empty / data */}
      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">טוען...</Card>
      ) : data && data.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
            <ShieldCheck className="h-7 w-7 text-emerald-600" />
          </div>
          <p className="font-medium">הכל עובד חלק!</p>
          <p className="text-sm text-muted-foreground">לא נרשמו שגיאות עיבוד</p>
        </Card>
      ) : (
        <>
          {/* DESKTOP: table */}
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-right">תאריך</TableHead>
                  <TableHead className="text-right">סוג</TableHead>
                  <TableHead className="text-right">תיאור</TableHead>
                  <TableHead className="text-right">הודעה מקורית</TableHead>
                  <TableHead className="text-right">שולח</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map((e) => {
                  const msg = e.incoming_messages;
                  const msgText = msg?.transcribed_text || msg?.raw_text || "";
                  return (
                    <TableRow key={e.id} className="hover:bg-muted/30">
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(e.created_at).toLocaleString("he-IL")}
                      </TableCell>
                      <TableCell>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                          {typeLabel(e.error_type)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-xs text-sm">{e.error_description || "—"}</TableCell>
                      <TableCell className="max-w-sm">
                        {msgText ? (
                          <div
                            className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground"
                            title={msgText}
                          >
                            {msgText}
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs" dir="ltr">
                        {msg?.sender_phone ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge resolved={!!e.resolved_at} />
                      </TableCell>
                      <TableCell>
                        {!e.resolved_at && (
                          <Button size="sm" variant="outline" onClick={() => mut.mutate(e.id)}>
                            <Check className="ml-1.5 h-4 w-4" />
                            סמן כטופל
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {/* MOBILE: cards */}
          <div className="space-y-3 md:hidden">
            {data?.map((e) => {
              const msg = e.incoming_messages;
              const msgText = msg?.transcribed_text || msg?.raw_text || "";
              return (
                <Card key={e.id} className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                      {typeLabel(e.error_type)}
                    </span>
                    <StatusBadge resolved={!!e.resolved_at} />
                  </div>

                  {e.error_description && <p className="mb-2 text-sm">{e.error_description}</p>}

                  {msgText && (
                    <p className="mb-2 whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      {msgText}
                    </p>
                  )}

                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {msg?.sender_phone && <span dir="ltr">{msg.sender_phone}</span>}
                    <span>{new Date(e.created_at).toLocaleString("he-IL")}</span>
                  </div>

                  {!e.resolved_at && (
                    <div className="border-t pt-3">
                      <Button size="sm" variant="outline" className="w-full" onClick={() => mut.mutate(e.id)}>
                        <Check className="ml-1.5 h-4 w-4" />
                        סמן כטופל
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

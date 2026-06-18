import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listOpenClarifications, cancelClarification } from "@/lib/clarifications.functions";
import { processMessage } from "@/lib/processing.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { HelpCircle, RotateCcw, X, ArrowLeft, CheckCircle2, Send, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/clarifications")({
  component: ClarificationsPage,
});

type Clarification = {
  id: string;
  message_id: string;
  raw_text: string | null;
  created_at: string;
  reply_sent_at: string | null;
  incoming_messages: { sender_phone: string | null } | null;
};

/** Status badge: "new" vs "request sent". */
function StatusBadge({ replySentAt }: { replySentAt: string | null }) {
  if (replySentAt) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">
        <Send className="h-3.5 w-3.5" />
        בקשת בירור נשלחה
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
      חדש
    </span>
  );
}

function ClarificationsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listOpenClarifications);
  const cancelFn = useServerFn(cancelClarification);
  const processFn = useServerFn(processMessage);

  const { data, isLoading } = useQuery({
    queryKey: ["open-clarifications"],
    queryFn: () => listFn() as Promise<Clarification[]>,
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { id } }),
    onSuccess: () => {
      toast.success("הבירור בוטל");
      qc.invalidateQueries({ queryKey: ["open-clarifications"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      qc.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reprocessMut = useMutation({
    mutationFn: (messageId: string) => processFn({ data: { messageId } }),
    onSuccess: () => {
      toast.success("עיבוד הופעל מחדש");
      qc.invalidateQueries({ queryKey: ["open-clarifications"] });
      qc.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const count = data?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header — amber accent (this is the "pending" screen) */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500">
          <HelpCircle className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-semibold leading-tight">בירורי לקוח פתוחים</h2>
          <p className="text-sm text-muted-foreground leading-tight">
            {data ? `${count} בירורים ממתינים לטיפול` : "טוען..."}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        הודעות שהמערכת לא הצליחה לשייך אוטומטית ללקוח. אפשר לבטל כדי לסגור, או להריץ את העיבוד מחדש לאחר תיקון.
      </div>

      {/* Loading / empty / data */}
      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">טוען...</Card>
      ) : count === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" />
          </div>
          <p className="font-medium">הכל מסודר!</p>
          <p className="text-sm text-muted-foreground">
            אין בירורים פתוחים כרגע
            <Sparkles className="mr-1 inline h-4 w-4" />
          </p>
        </Card>
      ) : (
        <>
          {/* DESKTOP: table */}
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-right">תאריך</TableHead>
                  <TableHead className="text-right">טלפון שולח</TableHead>
                  <TableHead className="text-right">הודעה מקורית</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map((c) => (
                  <TableRow key={c.id} className="hover:bg-muted/30">
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(c.created_at).toLocaleString("he-IL")}
                    </TableCell>
                    <TableCell dir="ltr" className="text-xs">
                      {c.incoming_messages?.sender_phone ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-md">
                      <div className="truncate rounded-lg bg-muted/50 px-3 py-1.5">{c.raw_text}</div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge replySentAt={c.reply_sent_at} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reprocessMut.isPending}
                          onClick={() => reprocessMut.mutate(c.message_id)}
                        >
                          <RotateCcw className="ml-1.5 h-4 w-4" />
                          עבד מחדש
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={cancelMut.isPending}
                          onClick={() => cancelMut.mutate(c.id)}
                        >
                          <X className="ml-1.5 h-4 w-4" />
                          בטל
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* MOBILE: cards */}
          <div className="space-y-3 md:hidden">
            {data?.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span dir="ltr" className="text-sm font-medium">
                    {c.incoming_messages?.sender_phone ?? "—"}
                  </span>
                  <StatusBadge replySentAt={c.reply_sent_at} />
                </div>

                <div className="mb-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">{c.raw_text}</div>
                <p className="mb-3 text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString("he-IL")}</p>

                <div className="flex gap-2 border-t pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={reprocessMut.isPending}
                    onClick={() => reprocessMut.mutate(c.message_id)}
                  >
                    <RotateCcw className="ml-1.5 h-4 w-4" />
                    עבד מחדש
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-destructive hover:text-destructive"
                    disabled={cancelMut.isPending}
                    onClick={() => cancelMut.mutate(c.id)}
                  >
                    <X className="ml-1.5 h-4 w-4" />
                    בטל
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          <Link to="/messages" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            <ArrowLeft className="h-4 w-4" />
            לעמוד ההודעות המלא
          </Link>
        </>
      )}
    </div>
  );
}

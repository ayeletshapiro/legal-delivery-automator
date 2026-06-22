import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listMessages } from "@/lib/messages.functions";
import { processMessage } from "@/lib/processing.functions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  MessageSquare,
  Play,
  RotateCcw,
  Type,
  Mic,
  Image as ImageIcon,
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Inbox,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/messages")({
  component: MessagesPage,
});

const statusLabels: Record<string, string> = {
  received: "התקבל",
  processing: "מעבד",
  done: "הושלם",
  failed: "נכשל",
  missing_client: "חסר לקוח",
  missing_details: "חסרים פרטים",
  transcription_failed: "תמלול נכשל",
  ignored: "התעלם",
  awaiting_clarification: "ממתין להבהרה",
  cancelled: "בוטל",
};

const typeLabels: Record<string, string> = {
  text: "טקסט",
  audio: "קולי",
  image: "תמונה",
  document: "PDF",
};

/** Icon per message type. */
function typeIcon(type: string): typeof Type {
  if (type === "audio") return Mic;
  if (type === "image") return ImageIcon;
  if (type === "document") return FileText;
  return Type;
}

/** Semantic style + icon per status. */
function statusStyle(status: string): { cls: string; Icon: typeof CheckCircle2 } {
  if (status === "done") {
    return { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 };
  }
  if (status === "failed" || status === "transcription_failed") {
    return { cls: "bg-red-50 text-red-700 border-red-200", Icon: AlertTriangle };
  }
  if (status === "cancelled" || status === "ignored") {
    return { cls: "bg-slate-50 text-slate-600 border-slate-200", Icon: XCircle };
  }
  return { cls: "bg-amber-50 text-amber-700 border-amber-200", Icon: Clock };
}

function StatusBadge({ status }: { status: string }) {
  const { cls, Icon } = statusStyle(status);
  const label = statusLabels[status] ?? status;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

type Message = {
  id: string;
  sender_phone: string;
  message_type: string;
  raw_text: string | null;
  transcribed_text: string | null;
  media_received: boolean;
  status: string;
  created_at: string;
};

function MessagesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMessages);
  const processFn = useServerFn(processMessage);
  const [status, setStatus] = useState<string>("all");
  const { data, isLoading } = useQuery({
    queryKey: ["messages", status],
    queryFn: () => listFn({ data: { status: status === "all" ? null : status } }) as Promise<Message[]>,
  });

  const processMut = useMutation({
    mutationFn: (messageId: string) => processFn({ data: { messageId } }),
    onSuccess: (res) => {
      if (res.ok) toast.success(res.status === "done" ? "עובד בהצלחה" : 'עובד — שובץ ל"מזדמנים"');
      else toast.error(res.errorMessage ?? "עיבוד נכשל");
      qc.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function canProcess(m: Message): boolean {
    return Boolean(
      (m.message_type === "text" && (m.raw_text || m.transcribed_text)) ||
      (m.message_type === "audio" && m.transcribed_text),
    );
  }
  function isReprocess(status: string): boolean {
    return ["done", "missing_client", "awaiting_clarification", "cancelled", "failed"].includes(status);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
            <MessageSquare className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-xl font-semibold leading-tight">הודעות נכנסות</h2>
            <p className="text-sm text-muted-foreground leading-tight">{data ? `${data.length} הודעות` : "טוען..."}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">הכל</SelectItem>
              {Object.entries(statusLabels).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">טוען...</Card>
      ) : data && data.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Inbox className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">אין הודעות להצגה</p>
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-right">תאריך</TableHead>
                  <TableHead className="text-right">שולח</TableHead>
                  <TableHead className="text-right">סוג</TableHead>
                  <TableHead className="text-right">תוכן</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right">פעולה</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map((m) => {
                  const TIcon = typeIcon(m.message_type);
                  return (
                    <TableRow key={m.id} className="hover:bg-muted/30">
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(m.created_at).toLocaleString("he-IL")}
                      </TableCell>
                      <TableCell dir="ltr" className="text-xs">
                        {m.sender_phone}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <TIcon className="h-4 w-4 text-muted-foreground" />
                          {typeLabels[m.message_type]}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-md truncate">
                        {m.transcribed_text || m.raw_text || (m.media_received ? "(מדיה)" : "—")}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={m.status} />
                      </TableCell>
                      <TableCell>
                        {canProcess(m) && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={processMut.isPending}
                            onClick={() => processMut.mutate(m.id)}
                          >
                            {isReprocess(m.status) ? (
                              <>
                                <RotateCcw className="ml-1.5 h-4 w-4" />
                                עבד מחדש
                              </>
                            ) : (
                              <>
                                <Play className="ml-1.5 h-4 w-4" />
                                עבד
                              </>
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <div className="space-y-3 md:hidden">
            {data?.map((m) => {
              const TIcon = typeIcon(m.message_type);
              const content = m.transcribed_text || m.raw_text || (m.media_received ? "(מדיה)" : "—");
              return (
                <Card key={m.id} className="p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <TIcon className="h-4 w-4 text-muted-foreground" />
                      <span dir="ltr" className="text-sm font-medium">
                        {m.sender_phone}
                      </span>
                    </div>
                    <StatusBadge status={m.status} />
                  </div>

                  <p className="mb-2 text-sm">{content}</p>
                  <p className="mb-3 text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("he-IL")}</p>

                  {canProcess(m) && (
                    <div className="border-t pt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={processMut.isPending}
                        onClick={() => processMut.mutate(m.id)}
                      >
                        {isReprocess(m.status) ? (
                          <>
                            <RotateCcw className="ml-1.5 h-4 w-4" />
                            עבד מחדש
                          </>
                        ) : (
                          <>
                            <Play className="ml-1.5 h-4 w-4" />
                            עבד
                          </>
                        )}
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

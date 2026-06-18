import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listOpenClarifications, cancelClarification } from "@/lib/clarifications.functions";
import { processMessage } from "@/lib/processing.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/clarifications")({
  component: ClarificationsPage,
});

function ClarificationsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listOpenClarifications);
  const cancelFn = useServerFn(cancelClarification);
  const processFn = useServerFn(processMessage);

  const { data, isLoading } = useQuery({
    queryKey: ["open-clarifications"],
    queryFn: () => listFn(),
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">בירורי לקוח פתוחים</h2>
        <Badge variant="secondary">{data?.length ?? 0} פתוחים</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        הודעות שהמערכת לא הצליחה לשייך אוטומטית. אפשר לבטל כדי לסגור, או להריץ את העיבוד מחדש.
      </p>

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">תאריך</TableHead>
                <TableHead className="text-right">טלפון שולח</TableHead>
                <TableHead className="text-right">הודעה מקורית</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs">{new Date(c.created_at).toLocaleString("he-IL")}</TableCell>
                  <TableCell dir="ltr" className="text-xs">{c.incoming_messages?.sender_phone ?? "—"}</TableCell>
                  <TableCell className="max-w-md truncate">{c.raw_text}</TableCell>
                  <TableCell>
                    {c.reply_sent_at
                      ? <Badge variant="secondary">בקשת בירור נשלחה</Badge>
                      : <Badge variant="outline">חדש</Badge>}
                  </TableCell>
                  <TableCell className="space-x-2 space-x-reverse">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reprocessMut.isPending}
                      onClick={() => reprocessMut.mutate(c.message_id)}
                    >
                      עבד מחדש
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={cancelMut.isPending}
                      onClick={() => cancelMut.mutate(c.id)}
                    >
                      בטל בירור
                    </Button>
                    <Link to="/messages" className="text-xs text-primary underline">לעמוד ההודעות</Link>
                  </TableCell>
                </TableRow>
              ))}
              {data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    אין בירורים פתוחים 🎉
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

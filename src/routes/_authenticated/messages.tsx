import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listMessages, createTestMessage } from "@/lib/messages.functions";
import { processMessage } from "@/lib/processing.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

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
};

const typeLabels: Record<string, string> = {
  text: "טקסט", audio: "קולי", image: "תמונה", document: "PDF",
};

function MessagesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMessages);
  const testFn = useServerFn(createTestMessage);
  const [status, setStatus] = useState<string>("all");
  const { data, isLoading } = useQuery({
    queryKey: ["messages", status],
    queryFn: () => listFn({ data: { status: status === "all" ? null : status } }),
  });

  const [open, setOpen] = useState(false);
  const [sender, setSender] = useState("");
  const [mtype, setMtype] = useState<"text" | "audio" | "image" | "document">("text");
  const [text, setText] = useState("");

  const testMut = useMutation({
    mutationFn: () => testFn({ data: { sender_phone: sender, message_type: mtype, raw_text: text } }),
    onSuccess: () => { toast.success("הודעת בדיקה נוצרה"); qc.invalidateQueries({ queryKey: ["messages"] }); setOpen(false); setText(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-2xl font-bold">הודעות נכנסות</h2>
        <div className="flex gap-2 items-center">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">הכל</SelectItem>
              {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button variant="outline">הוסף הודעת בדיקה</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>הודעת בדיקה (פנימי בלבד)</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2"><Label>טלפון שולח</Label><Input value={sender} onChange={(e) => setSender(e.target.value)} dir="ltr" placeholder="+972..." /></div>
                <div className="space-y-2">
                  <Label>סוג הודעה</Label>
                  <Select value={mtype} onValueChange={(v) => setMtype(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(typeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>טקסט גולמי</Label><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></div>
              </div>
              <DialogFooter>
                <Button onClick={() => testMut.mutate()} disabled={!sender.trim() || testMut.isPending}>צור</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        {isLoading ? <div className="p-8 text-center text-muted-foreground">טוען...</div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">תאריך</TableHead>
                <TableHead className="text-right">שולח</TableHead>
                <TableHead className="text-right">סוג</TableHead>
                <TableHead className="text-right">תוכן</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{new Date(m.created_at).toLocaleString("he-IL")}</TableCell>
                  <TableCell dir="ltr" className="text-xs">{m.sender_phone}</TableCell>
                  <TableCell>{typeLabels[m.message_type]}</TableCell>
                  <TableCell className="max-w-md truncate">{m.transcribed_text || m.raw_text || (m.media_received ? "(מדיה)" : "—")}</TableCell>
                  <TableCell><Badge variant="secondary">{statusLabels[m.status] ?? m.status}</Badge></TableCell>
                </TableRow>
              ))}
              {data?.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">אין הודעות</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

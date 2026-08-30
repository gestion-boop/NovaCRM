import { Dialog, DialogContent } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  embed: { url: string; title: string } | null;
}

export function MapEmbedModal({ open, onOpenChange, embed }: Props) {
  if (!embed) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <div className="p-4 pb-0">
          <h2 className="font-bold text-lg">{embed.title}</h2>
        </div>
        <div className="aspect-video">
          <iframe
            title={embed.title}
            src={embed.url}
            loading="lazy"
            allowFullScreen
            className="w-full h-full border-0"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

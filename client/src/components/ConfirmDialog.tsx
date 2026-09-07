import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  variant?: "danger" | "warning" | "default";
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title = "Confirmer la suppression",
  description = "Cette action est irréversible. Êtes-vous sûr de vouloir continuer ?",
  confirmLabel = "Supprimer",
  cancelLabel = "Annuler",
  onConfirm,
  variant = "danger",
}: ConfirmDialogProps) {
  const confirmClass =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : variant === "warning"
        ? "bg-amber-600 hover:bg-amber-700 text-white"
        : "bg-[#1B4B6B] hover:bg-[#0d4a85] text-white";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction className={confirmClass} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

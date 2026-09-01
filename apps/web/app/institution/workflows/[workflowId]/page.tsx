import { InstitutionWorkflowRoom } from "../../institution-dashboard";

export default async function WorkflowRoomPage({ params }: { params: Promise<{ workflowId: string }> }) {
  return <InstitutionWorkflowRoom workflowId={(await params).workflowId} />;
}

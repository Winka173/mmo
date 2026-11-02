import { notFound } from "next/navigation";
import StudioWorkspace from "../../components/StudioWorkspace";
export default async function Page({ params }: { params: Promise<{view:string}> }) {
 const {view}=await params; if(!["projects","overview","autopilots","create","production","editor","library","models","settings","telegram","review","planner","channels","insights"].includes(view)) notFound();
 return <StudioWorkspace view={view}/>;
}

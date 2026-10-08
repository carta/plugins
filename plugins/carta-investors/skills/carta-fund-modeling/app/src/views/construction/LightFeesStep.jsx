// Simple plans set fees and expenses the same way Advanced plans do; FeesStep reads whichever fee settings the plan has.
import FeesStep from "./FeesStep.jsx";

export default function LightFeesStep(props) {
  return <FeesStep {...props} />;
}

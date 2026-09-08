import StudyPlanPage from "../plan/page";

export default function CoursesPage() {
  return (
    <StudyPlanPage
      initialTab="courses"
      standalone
      excludedCourseCreators={["鄭泓"]}
    />
  );
}

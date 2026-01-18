This is going to be a webapp that will require Auth to use.
Inside the app, a user can manage their own tasks on a Kanban-style interface.
There are several important surfaces: 
1. "Capture" is a place where quick notes can be added, they later have to be triaged into another format (e.g. tasks or notes).
2. "Tasks" are little jobs to be done that can have a date attached, and tags
3. "Notes" are readme files that captures can be copied into, if desired. They also have tags.
4. "Tags" are hierarchical - There will be high level ones like Work, Personal, and then individual projects or groupings within those.

Architecturally, this app shuld use Convex, and whatever the latest, easiest form of Auth to use with Convex is (check the latest web).

The app should be a next.js app, using Convex, and easy to deploy. For now we'll want to focus on getting it all to run locally.

All reads and writes should be protected with Auth - in the future we might want to support sharing, but not yet.

Also, we should prepare to use some AI for parts of the app - some core possible flows involve:- Suggesting tags for new notes / tasks
- Suggesting to turn a capture into a task (with tags)
- Updating a note with new capture content, after a search to find a relevant one. 

We should use Convex RAG features for searching, and probably OpenAI apis for LLM completions.

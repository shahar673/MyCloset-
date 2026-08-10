# MyCloset 👗

הארון הדיגיטלי שלך, עם עין סגנונית משלו.

אפליקציית ווב מלאה: הרשמה/התחברות עם אימייל וסיסמה, ארון בגדים עם ניתוח AI אוטומטי,
המלצות לבוש לפי מזג אוויר ואופי האירוע, בדיקת לוק עם ציון, היסטוריית לוקים, והמלצות קניה.
כל המידע נשמר בחשבון שלך בשרת — לא צריך להזין את הארון מחדש בכל פעם.

## הרצה מקומית

דרישה: Node.js 18+.

1. `npm install`
2. העתיקו `.env.example` ל-`.env`, מלאו `ANTHROPIC_API_KEY` ו-`JWT_SECRET`
3. `npm start`
4. פתחו `http://localhost:3000`

## פריסה לאינטרנט (Render.com)

1. העלו את הקוד ל-GitHub
2. ב-Render: New + → Web Service → חברו את ה-repo
3. Build Command: `npm install` | Start Command: `npm start`
4. הוסיפו Environment Variables: `ANTHROPIC_API_KEY`, `JWT_SECRET`
5. Create Web Service — תקבלו כתובת ציבורית כמו `https://mycloset-xxxx.onrender.com`

⚠️ בשכבה החינמית האחסון זמני — לשמירת נתונים קבועה צריך Persistent Disk (בתשלום) או Railway.app.

## התקנה בטלפון כאפליקציה

**אנדרואיד (Chrome):** פתחו את האתר ← תפריט (⋮) ← "התקן אפליקציה" / "הוסף למסך הבית"
**אייפון (Safari):** פתחו את האתר ← כפתור שיתוף ← "הוסף למסך הבית"

## מבנה הפרויקט

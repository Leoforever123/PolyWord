## 后端运行
```bash
cd backend
python -m venv .venv
# mac/linux
source .venv/bin/activate
# windows powershell
# .venv\Scripts\Activate.ps1

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
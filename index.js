import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import connectMongo from 'connect-mongo'
import session from 'express-session'
import multer from 'multer'
import md5 from 'md5'
import dotenv from 'dotenv'
import db from './db.js'
import path from 'path'
import FTPStorage from 'multer-ftp'
import fs from 'fs'

dotenv.config()
const MongoStore = connectMongo(session)
const app = express()

app.use(bodyParser.json())
app.use(cors({
  // 照理來說, 我們要去判斷東西是哪裡來的
  origin (origin, callback) {
    // 開發環境, 允許
    if (origin === undefined) {
      callback(null,true)
    } else {
      if (process.env.ALLOW_CORS === 'true') {
        callback(null, true)
        // 非開發環境, 但是從github過來, 允許
      } else if (origin.includes('github')) {
        callback(null, true)
      } else {
        // 沒有從DEV 或 github來的話, 拒絕(要寫錯誤)
        callback(new Error('Not allowed'), false)
      }
    }
  },
  // 允許認證資訊
  credentials: true
}))

app.use(session({
  // 金鑰隨便取名
  secret: 'album',
  // 將 session 存入 mongodb
  store: new MongoStore({
    // 使用 mongoose 的資料庫連接
    mongooseConnection: db.connection,
    // session我們要去區分是哪一個網站
    // 設定存入的 collection
    collection: process.env.COLLECTION_SESSION
  }),
  // session 有效期間
  cookie: {
    // 1000 毫秒 = 一秒鐘
    // 1000 毫秒 * 60 = 一分鐘
    // 1000 毫秒 * 60 * 30 = 三十分鐘
    maxAge: 1000 * 60 * 30
  },
  // 是否保存未修改的 session
  saveUninitialized: false,
  // 是否每次重設過期時間
  rolling: true,
  resave: true
}))

let storage
if (!process.env.FTP === 'false') {
  // 開發環境將上傳檔案放本機
  storage = multer.diskStorage({
    destination (req, file, cb) {
      cb(null, 'images/')
    },
    filename (req, file, cb) {
      cb(null, Date.now() + path.extname(file.originalname))
    }
  })
} else {
  // heroku 將上傳檔案放伺服器
  storage = new FTPStorage({
    // 上傳伺服器的路徑
    basepath: '/',
    // FTP 設定
    ftp: {
      host: process.env.FTP_HOST,
      secure: false,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD
    },
    destination (req, file, options, cb) {
      cb(null, options.basepath + Date.now() + path.extname(file.originalname))
    }
  })
}

const upload = multer({
  storage,
  fileFilter (req, file, cb) {
    if (!file.mimetype.includes('image')) {
      // 觸發 multer 錯誤，不接受檔案
      // LIMIT_FORMAT 是自訂的錯誤 CODE，跟內建的錯誤 CODE 格式統一
      cb(new multer.MulterError('LIMIT_FORMAT'), false)
    } else {
      cb(null, true)
    }
  },
  limits: {
    fileSize: 1024 * 1024
  }
})

app.listen(process.env.PORT, () => {
  console.log('已啟動')
})

app.post('/users', async (req, res) => {
  // 如果進來的資料型態不是json的話, 要擋住
  if (!req.headers['content-type'].includes('application/json')) {
    res.status(400)
    res.send({
      success: false,
      message: '格式不符'
    })
    return
  }
  try {
    await db.users.create({
      account: req.body.account,
      password: md5(req.body.password)
    })
    res.status(200)
    res.send({
      success: true,
      message: ''
    })
  } catch (error) {
    if (error.name === 'ValidationError') {
      // 對方資料格式錯誤
      const key = Object.keys(error.errors)[0]
      const message = error.errors[key].message
      res.status(400)
      res.send({
        success: false,
        message
      })
    } else {
      // 我們伺服器錯誤
      res.status(500)
      res.send({
        success: false,
        message: '伺服器錯誤'
      })
    }
  }
})

// 登入
app.post('/login', async (req, res) => {
  // 如果進來的資料型態不是json的話, 要擋住
  if (!req.headers['content-type'].includes('application/json')) {
    res.status(400)
    res.send({
      success: false,
      message: '格式不符'
    })
    return
  }
  try {
    // 去資料庫找使用者
    // result就是查尋的紀錄
    const result = await db.users.find({
      account: req.body.account,
      password: md5(req.body.password)
    })
    // 如果我查詢有結果, 那麼我去設定這個人在server的變數叫user, 內容是我們結果的第一筆帳號
    if (result.length > 0) {
      req.session.user = result[0].account
      res.status(200)
      res.send({
        success: true,
        message: ''
      })
    } else {
      res.status(404)
      res.send({
        success: false,
        message: '帳號密碼錯誤'
      })
    }
  } catch (error) {
    if (error.name === 'ValidationError') {
      // 對方資料格式錯誤
      const key = Object.keys(error.errors)[0]
      const message = error.errors[key].message
      res.status(400)
      res.send({
        success: false,
        message
      })
    } else {
      // 我們伺服器錯誤
      res.status(500)
      res.send({
        success: false,
        message: '伺服器錯誤'
      })
    }
  }
})

// 登出
app.delete('/logout', async (req, res) => {
  // 清除登陸狀態
  req.session.destroy((error) => {
    if (error) {
      // 沒有傳東西進來, 我們的問題
      res.status(500)
      res.send({ success: false, message: '伺服器錯誤' })
    } else {
      res.clearCookie()
      res.status(200)
      res.send({ success: true, message: '' })
    }
  })
})

// 心跳, 單純的回傳目前在狀態, 以防使用者期效在後端30分鐘後過期(前端定期跟heartbeat要資料)
// 因為我們的資料存在瀏覽器的localStorage, 他不會自己跟後端溝通, 所以當我們開啟網頁的時候, 先去檢查後端有沒有過期, 如果有過期的話, 我們就去把localStorage登入狀態給清掉
app.get('/heartbeat', async (req, res) => {
  let islogin = false
  if (req.session.user !== undefined) {
    islogin = true
  }
  res.status(200)
  res.send(islogin)
  // res.send(req.session.user !== undefined)
})

app.post('/file', async (req, res) => {
  // 沒有登入
  if (req.session.user === undefined) {
    res.status(401)
    res.send({ success: false, message: '未登入' })
    return
  }
  if (!req.headers['content-type'].includes('multipart/form-data')) {
    res.status(400)
    res.send({ success: false, message: '格式不符' })
    return
  }

  // 有一個上傳進來的檔案，欄位是 image
  // req，進來的東西
  // res，要出去的東西
  // err，檔案上傳的錯誤
  // upload.single(欄位)(req, res, 上傳完畢的 function)
  upload.single('image')(req, res, async error => {
    if (error instanceof multer.MulterError) {
      // 上傳錯誤
      let message = ''
      if (error.code === 'LIMIT_FILE_SIZE') {
        message = '檔案太大'
      } else {
        message = '格式不符'
      }
      res.status(400)
      res.send({ success: false, message })
    } else if (error) {
      res.status(500)
      res.send({ success: false, message: '伺服器錯誤' })
    } else {
      try {
        // node.js官方文件, 預設的path套件
        // 本地用filename, 雲端用path
        // 會直接撈文字檔案給我
        let name = ''
        if (process.env.FTP === 'true') {
          name = path.basename(req.file.path)
        } else {
          name = req.file.filename
        }
        const result = await db.files.create(
          {
            user: req.session.user,
            description: req.body.description,
            name
          }
        )
        res.status(200)
        res.send({ success: true, message: '', name, _id: result._id })
      } catch (error) {
        if (error.name === 'ValidationError') {
          // 資料格式錯誤
          const key = Object.keys(error.errors)[0]
          const message = error.errors[key].message
          res.status(400)
          res.send({ success: false, message })
        } else {
          // 伺服器錯誤
          res.status(500)
          res.send({ success: false, message: '伺服器錯誤' })
        }
      }
    }
  })
})

app.get('/file/:name', async (req, res) => {
  if (req.session.user === undefined) {
    res.status(401)
    res.send({ success: false, message: '未登入' })
    return
  }
  if (!process.env.FTP === 'false') {
    const path = process.cwd() + '/images/' + req.params.name
    const exists = fs.existsSync(path)
    if (exists) {
      res.status(200)
      res.sendFile(path)
    } else {
      res.status(404)
      res.send({ success: false, message: '找不到圖片' })
    }
  } else {
    res.redirect('http://' + process.env.FTP_HOST + '/' + process.env.FTP_USER + '/' + req.params.name)
  }
})

app.get('/album/:user', async (req, res) => {
  if (req.session.user === undefined) {
    res.status(401)
    res.send({ success: false, message: '未登入' })
    return
  }
  if (req.session.user !== req.params.user) {
    res.status(403)
    res.send({ success: false, message: '無權限' })
    return
  }

  try {
    const result = await db.files.find({ user: req.params.user })
    res.status(200)
    res.send({ success: true, message: '', result })
  } catch (error) {
    res.status(500)
    res.send({ success: false, message: '伺服器錯誤' })
  }
})

app.patch('/file/:id', async (req, res) => {
  if (!req.headers['content-type'].includes('application/json')) {
    res.status(400)
    res.send({ success: false, message: '格式不符' })
    return
  }
  // 沒有登入
  if (!req.session.user) {
    res.status(401)
    res.send({ success: false, message: '無權限' })
    return
  }

  try {
    // 檢查相片擁有者是不是本人
    let result = await db.files.findById(req.params.id)
    if (result.user !== req.session.user) {
      res.status(403)
      res.send({ success: false, message: '無權限' })
      return
    }
    // findByIdAndUpdate 預設回傳的是更新前的資料
    // 設定 new true 後會變成回傳新的資料
    result = await db.files.findByIdAndUpdate(req.params.id, req.body, { new: true })
    res.status(200)
    res.send({ success: true, message: '', result })
  } catch (error) {
    if (error.name === 'CastError') {
      // ID 格式不是 MongoDB 的格式
      res.status(400)
      res.send({ success: false, message: 'ID 格式錯誤' })
    } else if (error.name === 'ValidationError') {
      // 資料格式錯誤
      const key = Object.keys(error.errors)[0]
      const message = error.errors[key].message
      res.status(400)
      res.send({ success: false, message })
    } else {
      // 伺服器錯誤
      res.status(500)
      res.send({ success: false, message: '伺服器錯誤' })
    }
  }
})

app.delete('/file/:id', async (req, res) => {
  // 沒有登入
  if (!req.session.user) {
    res.status(401)
    res.send({ success: false, message: '無權限' })
    return
  }

  try {
    // 檢查相片擁有者是不是本人
    let result = await db.files.findById(req.params.id)
    if (result.user !== req.session.user) {
      res.status(403)
      res.send({ success: false, message: '無權限' })
      return
    }
    // findByIdAndUpdate 預設回傳的是更新前的資料
    // 設定 new true 後會變成回傳新的資料
    result = await db.files.findByIdAndDelete(req.params.id)
    if (result === null) {
      res.status(404)
      res.send({ success: true, message: '找不到資料' })
    } else {
      res.status(200)
      res.send({ success: true, message: '', result })
    }
  } catch (error) {
    if (error.name === 'CastError') {
      // ID 格式不是 MongoDB 的格式
      res.status(400)
      res.send({ success: false, message: 'ID 格式錯誤' })
    } else {
      // 伺服器錯誤
      res.status(500)
      res.send({ success: false, message: '伺服器錯誤' })
    }
  }
})

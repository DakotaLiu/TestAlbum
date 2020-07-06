import Vue from 'vue'
import Vuex from 'vuex'
import createPersistedState from 'vuex-persistedstate'

Vue.use(Vuex)

export default new Vuex.Store({
  state: {
    user: ''
  },
  // 修改狀態的 function
  mutations: {
    // 登入寫入data
    login (state, data) {
      state.user = data
    },
    // 登出把user 清空
    logout (state) {
      state.user = ''
    }
  },
  // 獲取資料的 function
  getters: {
    user (state) {
      return state.user
    }
  },
  // 伴隨 vuex-persistedstate寫入
  plugins: [createPersistedState()]
})

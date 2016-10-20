import { Component, createElement } from 'react'
import storeShape from '../utils/storeShape'
import shallowEqual from '../utils/shallowEqual'
import wrapActionCreators from '../utils/wrapActionCreators'
import warning from '../utils/warning'
import isPlainObject from 'lodash/isPlainObject'
import hoistStatics from 'hoist-non-react-statics'
import invariant from 'invariant'

// 默认不监听state
const defaultMapStateToProps = state => ({}) // eslint-disable-line no-unused-vars
// 默认监听dispatch
const defaultMapDispatchToProps = dispatch => ({ dispatch })
const defaultMergeProps = (stateProps, dispatchProps, parentProps) => ({
  ...parentProps,
  ...stateProps,
  ...dispatchProps
})

function getDisplayName(WrappedComponent) {
  return WrappedComponent.displayName || WrappedComponent.name || 'Component'
}

let errorObject = { value: null }
function tryCatch(fn, ctx) {
  try {
    return fn.apply(ctx)
  } catch (e) {
    errorObject.value = e
    return errorObject
  }
}

// Helps track hot reloading.
let nextVersion = 0

export default function connect(mapStateToProps, mapDispatchToProps, mergeProps, options = {}) {
  // 是否订阅store
  const shouldSubscribe = Boolean(mapStateToProps)
  // 决定store的merge方式
  // 默认是返回一个空对象！
  const mapState = mapStateToProps || defaultMapStateToProps

  // 决定dispatch的merge
  let mapDispatch
  if (typeof mapDispatchToProps === 'function') {
    mapDispatch = mapDispatchToProps
  } else if (!mapDispatchToProps) {
    mapDispatch = defaultMapDispatchToProps
  } else {
    mapDispatch = wrapActionCreators(mapDispatchToProps)
  }

  // 决定最后merge到props的方式
  const finalMergeProps = mergeProps || defaultMergeProps
  const { pure = true, withRef = false } = options

  const checkMergedEquals = pure && finalMergeProps !== defaultMergeProps

  // Helps track hot reloading.
  const version = nextVersion++

  return function wrapWithConnect(WrappedComponent) {
    const connectDisplayName = `Connect(${getDisplayName(WrappedComponent)})`

    // 检查props需要为一个对象
    // 只能是{}或者{a: 1}这个类型哦，数组或函数都不行
    function checkStateShape(props, methodName) {
      if (!isPlainObject(props)) {
        warning(
          `${methodName}() in ${connectDisplayName} must return a plain object. ` +
          `Instead received ${props}.`
        )
      }
    }

    function computeMergedProps(stateProps, dispatchProps, parentProps) {
      const mergedProps = finalMergeProps(stateProps, dispatchProps, parentProps)
      if (process.env.NODE_ENV !== 'production') {
        checkStateShape(mergedProps, 'mergeProps')
      }
      return mergedProps
    }

    class Connect extends Component {
      shouldComponentUpdate() {
        return !pure || this.haveOwnPropsChanged || this.hasStoreStateChanged
      }

      // 1、完成store的初始化
      // 2、cache的初始化
      constructor(props, context) {
        super(props, context)
        this.version = version
        this.store = props.store || context.store

        invariant(this.store,
          `Could not find "store" in either the context or ` +
          `props of "${connectDisplayName}". ` +
          `Either wrap the root component in a <Provider>, ` +
          `or explicitly pass "store" as a prop to "${connectDisplayName}".`
        )

        // 在state里存store
        const storeState = this.store.getState()
        this.state = { storeState }

        this.clearCache()
      }

      // 根据mapStateToProps和store
      // 得到更新后的state
      computeStateProps(store, props) {
        // 因为mapStateToProps可以返回一个function作为mapStateToProps
        // 用于memoization啦
        if (!this.finalMapStateToProps) {
          // 第一次来，需要configure“安装”mapState
          return this.configureFinalMapState(store, props)
        }

        // 根据是否只依赖ownProps来更新state
        const state = store.getState()
        const stateProps = this.doStatePropsDependOnOwnProps ?
          this.finalMapStateToProps(state, props) :
          this.finalMapStateToProps(state)

        // 这里为什么stateProps要为空对象哦
        if (process.env.NODE_ENV !== 'production') {
          checkStateShape(stateProps, 'mapStateToProps')
        }
        return stateProps
      }

      // 该函数只被调用一次，用于安装mapStateToProps的相关信息
      //  1、map的函数
      //  2、是否依赖ownProps
      configureFinalMapState(store, props) {
        const mappedState = mapState(store.getState(), props)
        const isFactory = typeof mappedState === 'function'

        this.finalMapStateToProps = isFactory ? mappedState : mapState
        // mapStateToProps(state, [ownProps])
        // 有[ownProps]就是只依赖ownProps
        this.doStatePropsDependOnOwnProps = this.finalMapStateToProps.length !== 1

        if (isFactory) {
          return this.computeStateProps(store, props)
        }

        if (process.env.NODE_ENV !== 'production') {
          checkStateShape(mappedState, 'mapStateToProps')
        }
        return mappedState
      }

      computeDispatchProps(store, props) {
        if (!this.finalMapDispatchToProps) {
          return this.configureFinalMapDispatch(store, props)
        }

        const { dispatch } = store
        const dispatchProps = this.doDispatchPropsDependOnOwnProps ?
          this.finalMapDispatchToProps(dispatch, props) :
          this.finalMapDispatchToProps(dispatch)

        if (process.env.NODE_ENV !== 'production') {
          checkStateShape(dispatchProps, 'mapDispatchToProps')
        }
        return dispatchProps
      }

      // 同上，用于确定finalMapDispatchToProps
      configureFinalMapDispatch(store, props) {
        const mappedDispatch = mapDispatch(store.dispatch, props)
        const isFactory = typeof mappedDispatch === 'function'

        this.finalMapDispatchToProps = isFactory ? mappedDispatch : mapDispatch
        this.doDispatchPropsDependOnOwnProps = this.finalMapDispatchToProps.length !== 1

        if (isFactory) {
          return this.computeDispatchProps(store, props)
        }

        if (process.env.NODE_ENV !== 'production') {
          checkStateShape(mappedDispatch, 'mapDispatchToProps')
        }
        return mappedDispatch
      }

      // shallowEqual三兄弟
      // 判断新旧state是否shallowEqual
      // 作用跟shouldComponentUpdate一样
      updateStatePropsIfNeeded() {
        const nextStateProps = this.computeStateProps(this.store, this.props)
        if (this.stateProps && shallowEqual(nextStateProps, this.stateProps)) {
          return false
        }

        this.stateProps = nextStateProps
        return true
      }

      updateDispatchPropsIfNeeded() {
        const nextDispatchProps = this.computeDispatchProps(this.store, this.props)
        if (this.dispatchProps && shallowEqual(nextDispatchProps, this.dispatchProps)) {
          return false
        }

        this.dispatchProps = nextDispatchProps
        return true
      }

      updateMergedPropsIfNeeded() {
        const nextMergedProps = computeMergedProps(this.stateProps, this.dispatchProps, this.props)
        // 能走到这里，是因为state, dispatch, ownProps有一个更新了
        // 那么除非用户自定义了finalMergeProps，不然mergedProps肯定更新了
        // 用checkMergedEquals节省一次shallowEqual
        if (this.mergedProps && checkMergedEquals && shallowEqual(nextMergedProps, this.mergedProps)) {
          return false
        }

        this.mergedProps = nextMergedProps
        return true
      }

      isSubscribed() {
        return typeof this.unsubscribe === 'function'
      }

      // 订阅后，store的更新会触发handleChange函数
      // 如果不传入mapStateToProps，就不订阅咯
      trySubscribe() {
        if (shouldSubscribe && !this.unsubscribe) {
          this.unsubscribe = this.store.subscribe(this.handleChange.bind(this))
          this.handleChange()
        }
      }

      // trick，已unsubscribe后把该函数置为null
      tryUnsubscribe() {
        if (this.unsubscribe) {
          this.unsubscribe()
          this.unsubscribe = null
        }
      }

      // 在didMount订阅store
      componentDidMount() {
        this.trySubscribe()
      }

      // 目前已知有两种方式触发组件更新
      // 1、组件接收新的props，即：ownProps
      componentWillReceiveProps(nextProps) {
        // 1、pure为false，总是默认ownProps变化的
        // 2、pure为false，当nextProps真的变化，haveOwnPropsChanged才为true
        if (!pure || !shallowEqual(nextProps, this.props)) {
          this.haveOwnPropsChanged = true
        }
      }

      // 清除相关数据
      componentWillUnmount() {
        this.tryUnsubscribe()
        this.clearCache()
      }

      clearCache() {
        // 三巨头
        this.dispatchProps = null
        this.stateProps = null
        this.mergedProps = null

        // 你们两个为什么初始化为true!
        this.haveOwnPropsChanged = true
        this.hasStoreStateChanged = true
        
        this.haveStatePropsBeenPrecalculated = false
        this.statePropsPrecalculationError = null
        this.renderedElement = null
        this.finalMapDispatchToProps = null
        this.finalMapStateToProps = null
      }

      // 2、store更新了，即:state
      // 所以dispatch一般情况是不会更新的
      // ！！！这里好像没有检查dispatch的更新啊！！！
      handleChange() {
        // trick！
        // 如果已经不监听了，则不搞事
        // 在组件卸载后，不在搞事
        if (!this.unsubscribe) {
          return
        }

        // store没有更新，则不做任何动作
        const storeState = this.store.getState()
        const prevStoreState = this.state.storeState
        if (pure && prevStoreState === storeState) {
          return
        }

        // 1、只依赖state，且shallowEqual相等，则不更新
        // 2、如果还依赖ownProps，则默认不shallowEqual，然后再render里比较ownProps是否更新
        if (pure && !this.doStatePropsDependOnOwnProps) {
          // haveStatePropsChanged值为boolean
          // 跟sCU一样，判断是否需要更新
          const haveStatePropsChanged = tryCatch(this.updateStatePropsIfNeeded, this)
          if (!haveStatePropsChanged) {
            return
          }
          if (haveStatePropsChanged === errorObject) {
            this.statePropsPrecalculationError = errorObject.value
          }
          // 哦哦，这里来表明是否state是否已经shallowEqual了
          this.haveStatePropsBeenPrecalculated = true
        }

        this.hasStoreStateChanged = true

        // 更新Provider的state
        // 触发render
        this.setState({ storeState })
      }

      getWrappedInstance() {
        invariant(withRef,
          `To access the wrapped instance, you need to specify ` +
          `{ withRef: true } as the fourth argument of the connect() call.`
        )

        return this.refs.wrappedInstance
      }

      // 总得来说
      // 1、若总props没更新，返回旧element
      // 2、若总props更新了，生成新的element，并返回
      render() {
        const {
          haveOwnPropsChanged, // ownProps是否改变
          hasStoreStateChanged, // state是否改变
          haveStatePropsBeenPrecalculated, // state的改变是否shallowEqual过
          statePropsPrecalculationError, // 比较还会出问题？
          renderedElement
        } = this

        // initial
        this.haveOwnPropsChanged = false
        this.hasStoreStateChanged = false
        this.haveStatePropsBeenPrecalculated = false
        this.statePropsPrecalculationError = null

        if (statePropsPrecalculationError) {
          throw statePropsPrecalculationError
        }

        // 1、依赖ownProps，则state和ownProps都变了才要update
        // 2、不依赖ownProps，则state变了才要update
        let shouldUpdateStateProps = true
        // 依赖ownProps，且ownProps变了，才要update
        let shouldUpdateDispatchProps = true

        // 检查ownProps是否改变
        if (pure && renderedElement) {
          shouldUpdateStateProps = hasStoreStateChanged || (
            haveOwnPropsChanged && this.doStatePropsDependOnOwnProps
          )
          shouldUpdateDispatchProps =
            haveOwnPropsChanged && this.doDispatchPropsDependOnOwnProps
        }

        // 检查state是否改变
        let haveStatePropsChanged = false
        let haveDispatchPropsChanged = false
        if (haveStatePropsBeenPrecalculated) {
          haveStatePropsChanged = true
        } else if (shouldUpdateStateProps) {
          haveStatePropsChanged = this.updateStatePropsIfNeeded()
        }

        // 检查dispatch是否改变
        if (shouldUpdateDispatchProps) {
          haveDispatchPropsChanged = this.updateDispatchPropsIfNeeded()
        }

        // 检查综合的props是否改变
        let haveMergedPropsChanged = true
        if (
          haveStatePropsChanged ||
          haveDispatchPropsChanged ||
          haveOwnPropsChanged
        ) {
          haveMergedPropsChanged = this.updateMergedPropsIfNeeded()
        } else {
          haveMergedPropsChanged = false
        }

        // 【离开点1】
        // 如果综合props没有更新，则返回旧的renderedElement
        if (!haveMergedPropsChanged && renderedElement) {
          return renderedElement
        }

        // 构建renderedeElement
        // 其中this.mergedProps为总props
        // 赋值到this.renderedElment，返回return渲染
        if (withRef) {
          this.renderedElement = createElement(WrappedComponent, {
            ...this.mergedProps,
            ref: 'wrappedInstance'
          })
        } else {
          this.renderedElement = createElement(WrappedComponent,
            this.mergedProps
          )
        }

        // 【离开点1】
        return this.renderedElement
      }
    }

    Connect.displayName = connectDisplayName
    Connect.WrappedComponent = WrappedComponent
    Connect.contextTypes = {
      store: storeShape
    }
    Connect.propTypes = {
      store: storeShape
    }

    if (process.env.NODE_ENV !== 'production') {
      Connect.prototype.componentWillUpdate = function componentWillUpdate() {
        if (this.version === version) {
          return
        }

        // We are hot reloading!
        this.version = version
        this.trySubscribe()
        this.clearCache()
      }
    }

    return hoistStatics(Connect, WrappedComponent)
  }
}
